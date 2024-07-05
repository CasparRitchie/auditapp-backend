const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const csvParser = require('csv-parser');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(bodyParser.json());
app.use(cors());  // Enable CORS for all routes

const csvFilePath = path.join(__dirname, 'audit_data.csv');

// Function to get existing headers from CSV
const getExistingHeaders = async (filePath) => {
  return new Promise((resolve, reject) => {
    const headers = [];
    if (fs.existsSync(filePath)) {
      fs.createReadStream(filePath)
        .pipe(csvParser())
        .on('headers', (headerList) => {
          headerList.forEach(header => headers.push(header));
          resolve(headers);
        })
        .on('error', (error) => {
          reject(error);
        });
    } else {
      resolve(headers);
    }
  });
};

// Function to sanitize keys and values by replacing "" with "
const sanitizeString = (str) => {
  return str.replace(/""/g, '"');
};

// Improved function to flatten nested JSON objects and arrays
const flattenObject = (obj, prefix = '') => {
  let flattened = {};
  for (let key in obj) {
    if (obj.hasOwnProperty(key)) {
      let newKey = sanitizeString(prefix ? `${prefix}_${key}` : key);
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        if (Array.isArray(obj[key])) {
          obj[key].forEach((item, index) => {
            if (typeof item === 'object' && item !== null) {
              Object.assign(flattened, flattenObject(item, `${newKey}_${index}`));
            } else {
              flattened[`${newKey}_${index}`] = sanitizeString(item.toString());
            }
          });
        } else {
          Object.assign(flattened, flattenObject(obj[key], newKey));
        }
      } else {
        flattened[newKey] = sanitizeString(obj[key].toString());
      }
    }
  }
  return flattened;
};

app.post('/submit-survey', async (req, res) => {
  const surveyData = flattenObject(req.body);

  try {
    let existingHeaders = await getExistingHeaders(csvFilePath);
    let newHeaders = Object.keys(surveyData);

    // Add new headers if they are not already present
    newHeaders.forEach(header => {
      if (!existingHeaders.includes(header)) {
        existingHeaders.push(header);
      }
    });

    // Create CSV writer with updated headers
    const csvWriter = createCsvWriter({
      path: csvFilePath,
      header: existingHeaders.map(header => ({ id: header, title: header })),
      append: fs.existsSync(csvFilePath)
    });

    // Write the survey data
    await csvWriter.writeRecords([surveyData]);
    res.status(200).send('Survey data saved successfully');
  } catch (error) {
    console.error('Error writing to CSV file', error);
    res.status(500).send('Error saving survey data');
  }
});

app.get('/', (req, res) => {
  res.send('Server is running');
});

// Use the PORT environment variable for Heroku or default to 3001
const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
