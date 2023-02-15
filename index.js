const express = require('express');
const multer = require('multer');
const csvParser = require('csv-parser');
const xlsx = require('xlsx');
const chartjs = require('chart.js');
const AWS = require('aws-sdk');

const app = express();
const upload = multer();

// AWS S3 setup
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

const s3 = new AWS.S3();

// API endpoint to upload CSV file
app.post('/upload', upload.single('file'), (req, res) => {
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
  const workbookObj = xlsx.utils.book_new();
  const worksheet = xlsx.utils.json_to_sheet(rows);
  xlsx.utils.book_append_sheet(
    workbookObj,
    worksheet,
    'Sheet 1'
  );
  const excelFile = xlsx.writeFile(workbookObj, 'file.xlsx');

  // Create Pie chart
  const genderCounts = rows.reduce(
    (acc, row) => {
      const gender = row['Column 1'];
      acc[gender] = (acc[gender] || 0) + 1;
      return acc;
    },
    {}
  );
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
          res.send({ excelFileUrl, chartImageUrl });
        }
      });
    }
  });
});

app.listen(3000, () => {
  console.log('Server started on port 3000');
});
