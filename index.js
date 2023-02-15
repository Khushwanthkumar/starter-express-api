const express = require('express');
const multer = require('multer');
const csvParser = require('csv-parser');
const AWS = require('aws-sdk');
const S3FS = require('@cyclic.sh/s3fs/promises');
const chartjs = require('chart.js');
// const canvas = require('canvas');

const app = express();
const upload = multer();

// AWS S3 setup
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});

const s3 = new AWS.S3();
const s3fs = new S3FS({
    region: process.env.MY_REGION,
        credentials:{
            accessKeyId: process.env.MY_AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.MY_AWS_SECRET_ACCESS_KEY
        }
});

// API endpoint to upload CSV file
app.post('/upload', upload.single('file'), async (req, res) => {
    const serialNumberColumnName = 'Serial Number';

    // Read CSV file and eliminate blank rows
    const rows = [];
    req.file.buffer
        .toString('utf-8')
        .split('\n')
        .forEach((row, index) => {
            if (row.trim() !== '') {
                const newRow = {};
                newRow[serialNumberColumnName] = index;
                row.split(',').forEach((cell, cellIndex) => {
                    newRow[`Column ${cellIndex + 1}`] = cell.trim();
                });
                rows.push(newRow);
            }
        });

    // Create Excel file
    const fileData = await s3fs.writeFile('file.xlsx', '');
    const worksheet = s3fs.createWriteStream('file.xlsx');
    const worksheetData = xlsx.utils.json_to_sheet(rows);
    xlsx.utils.book_append_sheet(worksheetData, worksheet);
    const excelFile = xlsx.writeFile(worksheetData, worksheet);

    // Create Pie chart
    const genderCounts = rows.reduce(
        (acc, row) => {
            const gender = row['Column 1'];
            acc[gender] = (acc[gender] || 0) + 1;
            return acc;
        },
        {}
    );
    const Chart = chartjs.Chart;
   const chart = new chartjs.Chart(
        document.createElement('canvas').getContext('2d'),
        {
            type: 'pie',
            data: {
                labels: Object.keys(genderCounts),
                datasets: [
                    {
                        data: Object.values(genderCounts),
                        backgroundColor: [
                            'rgb(255, 99, 132)',
                            'rgb(54, 162, 235)',
                            'rgb(255, 205, 86)'
                        ]
                    }
                ]
            }
        }
    );
    const chartImage = chart.toBase64Image();

    // Upload files to S3
    const s3Params = {
        Bucket: process.env.S3_BUCKET,
        Key: `file-${Date.now()}.xlsx`,
        Body: excelFile
    };
    s3.upload(s3Params, (err, data) => {
        if (err) {
            console.error(err);
            res.status(500).send('Error uploading file to S3');
        } else {
            const excelFileUrl = data.Location;
            const s3Params = {
                Bucket: process.env.S3_BUCKET,
                Key: `chart-${Date.now()}.png`,
                Body: chartImage
            };
            s3.upload(s3Params, (err, data) => {
                if (err) {
                    console.error(err);
                    res.status(500).send('Error uploading chart to S3');
                } else {
                    const chartImageUrl = data.Location;
                    // Return file URLs in response
                    res.status(200).json({
                        excelFileUrl,
                        chartImageUrl
                    });
                }
            });
        }
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
