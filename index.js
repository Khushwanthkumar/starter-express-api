const express = require('express');
const multer = require('multer');
const csvtojson = require('csvtojson');
const json2xls = require('json2xls');
const ExcelJS = require('exceljs');
const AWS = require('aws-sdk');

// Configure AWS
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const app = express();

// Set storage engine for multer to save uploaded file
const storage = multer.diskStorage({
    destination: (req, file, callback) => {
        callback(null, './uploads/');
    },
    filename: (req, file, callback) => {
        callback(null, file.originalname);
    }
});

const upload = multer({ storage: storage });

app.post('/upload-csv', upload.single('csv'), (req, res) => {
    // Read CSV file and convert to JSON
    csvtojson()
        .fromFile(req.file.path)
        .then((jsonObj) => {
            // Filter blank rows and assign serial number
            const filteredJsonObj = jsonObj
                .filter((row) => Object.values(row).some((value) => value !== ''))
                .map((row, index) => ({ '#': index + 1, ...row }));

            // Convert to Excel file
            const xlsData = json2xls(filteredJsonObj);
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Sheet 1');
            worksheet.columns = [
                { header: '#', key: '#' },
                { header: 'Name', key: 'name' },
                { header: 'Gender', key: 'gender' }
            ];
            worksheet.addRows(filteredJsonObj);

            // Generate Pie chart
            const pieChart = workbook.addWorksheet('Gender Ratio');
            const genderData = filteredJsonObj.reduce(
                (data, row) => {
                    const gender = row.gender;
                    data[gender] = (data[gender] || 0) + 1;
                    return data;
                },
                {}
            );
            const pieChartLabels = Object.keys(genderData);
            const pieChartValues = pieChartLabels.map((label) => genderData[label]);
            pieChart.addChart({
                title: 'Gender Ratio',
                type: 'pie',
                data: {
                    labels: pieChartLabels,
                    datasets: [{ data: pieChartValues }]
                },
                position: { x: 0, y: 0, width: 20, height: 15 }
            });

            // Save Excel file and Pie chart as PNG
            workbook.xlsx.writeFile('result.xlsx').then(() => {
                const chartPngBuffer = pieChart.getImageBuffer();
                chartPngBuffer.then((buffer) => {
                    s3.upload(
                        {
                            Bucket: process.env.AWS_BUCKET_NAME,
                            Key: 'result.xlsx',
                            Body: xlsData,
                            ContentType: 'application/vnd.ms-excel'
                        },
                        (err, data) => {
                            if (err) {
                                res.status(500).send('Error uploading file');
                                return;
                            }
                            s3.upload(
                                {
                                    Bucket: process.env.AWS_BUCKET_NAME,
                                    Key: 'chart.png',
                                    Body: buffer,
                                    ContentType: 'image/png'
                                },
                                (err, data) => {
                                    if (err) {
                                        res.status(500).send('Error uploading file');
                                        return;
                                    }
                                    res.json({
                                        excelFileUrl: data.Location,
                                        chartImageUrl: data.Location
                                    });
                                }
                            );
                        }
                    );
                });
            });
        })
        .catch((err) => {
            res.status(500).send('Error processing CSV file');
        });
});

app.listen(process.env.PORT || 3000, () => {
    console.log('Server started');
});
