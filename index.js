const express = require('express');
const multer = require('multer');
const csv = require('csvtojson');
const xlsx = require('xlsx');
const excel = require('excel4node');
const fs = require('@cyclic.sh/s3fs/promises');
const AWS = require('aws-sdk');
const sharp = require('sharp');
const app = express();

app.all('/', (req, res) => {
    console.log("Just got a request!")
    res.send('Yo!')
})

// Initialize AWS S3 bucket
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'YOUR_ACCESS_KEY_ID',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'YOUR_SECRET_ACCESS_KEY',
    region: process.env.AWS_REGION || 'YOUR_REGION'
});

// Set up Multer storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, '/tmp')
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname)
    }
});

// Set up Multer upload
// const upload = multer({ storage: storage });
// const csvFilter = (req, file, cb) => {
//   if (file.mimetype.includes("csv")) {
//     cb(null, true);
//   } else {
//     cb("Please upload only csv file.", false);
//   }
// };
const upload = multer({ dest: "/tmp" });

// Define API endpoint for file upload
app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        // Read CSV file and eliminate blank rows
        const jsonArray = await csv({ noheader: true }).fromFile(req.file.path);
        const filteredArray = jsonArray.filter(row => Object.values(row).some(cell => cell !== ''));

        // Insert serial number column
        const resultArray = filteredArray.map((row, index) => ({ ...row, SerialNumber: index + 1 }));

        // Create Excel workbook and worksheet
        const wb = new excel.Workbook();
        const ws = wb.addWorksheet('Data');

        // Write headers and data to Excel worksheet
        const headers = Object.keys(resultArray[0]);
        ws.cell(1, 1).string('Serial Number');
        headers.forEach((header, index) => {
            ws.cell(1, index + 2).string(header);
        });
        resultArray.forEach((row, rowIndex) => {
           ws.cell(rowIndex + 2, 1).string(row.SerialNumber.toString())
            headers.forEach((header, index) => {
                ws.cell(rowIndex + 2, index + 2).string(row[header].toString());
            });
        });

        // Save Excel workbook to file
        const excelFilename = `output-${new Date().getTime()}.xlsx`;
        wb.write(excelFilename);

        // Generate pie chart using sharp
        const maleCount = resultArray.filter(row => row.Gender === 'Male').length;
        const femaleCount = resultArray.filter(row => row.Gender === 'Female').length;
        const total = resultArray.length;
        const pieData = [{ name: 'Male', value: maleCount }, { name: 'Female', value: femaleCount }];
        const chart = sharp(Buffer.from(JSON.stringify(pieData)));
        chart.resize(300, 300).toBuffer().then(buffer => sharp(buffer).background({ r: 255, g: 255, b: 255, alpha: 1 }).png());
        const chartFilename = `chart-${new Date().getTime()}.png`;
        chart.toFile(chartFilename);

        // Upload files to S3 bucket
        const excelFile = await fs.readFile(excelFilename);
        const chartFile = await fs.readFile(chartFilename);
        const excelParams = {
            Bucket: process.env.BUCKET,
            Key: excelFilename,
            Body: excelFile
        };
        const chartParams = {
            Bucket: process.env.BUCKET,
            Key: chartFilename,
            Body: chartFile
        };
        await s3.upload(excelParams).promise();
        await s3.upload(chartParams).promise();

        // Get S3 file URLs
        const excelUrl = s3.getSignedUrl('getObject', { Bucket: process.env.BUCKET, Key: excelFilename });
        const chartUrl = s3.getSignedUrl('getObject', { Bucket: process.env.BUCKET, Key: chartFilename });

        // Return file URLs in API response
        res.json({ excelUrl, chartUrl });

        // Delete local files
        fs.unlinkSync(req.file.path);
        fs.unlinkSync(excelFilename);
        fs.unlinkSync(chartFilename);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// Start the server
app.listen(process.env.PORT || 3000)
