const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const csvParser = require('csv-parser');
const path = require('path');
const cors = require('cors');
const { Storage } = require('@google-cloud/storage');

const app = express();
app.use(bodyParser.json({ limit: '50mb' })); // Increase the limit for JSON payloads
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true })); // Increase the limit for URL-encoded payloads

const corsOptions = {
  origin: 'https://auditapp-26aa21253884.herokuapp.com', // Your frontend URL
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));  // Enable CORS for all routes

// Decode base64 encoded service account key
const serviceAccountBase64 = process.env.GCP_KEY_BASE64;
const serviceAccountDecoded = Buffer.from(serviceAccountBase64, 'base64').toString('utf8');

// Write the decoded key to a file
const keyFilePath = path.join(__dirname, 'service-account-key.json');
fs.writeFileSync(keyFilePath, serviceAccountDecoded);

// Configure Google Cloud Storage
const storage = new Storage({
  projectId: 'your-gcp-project-id', // Replace with your GCP project ID
  keyFilename: keyFilePath // Path to the decoded key file
});

const bucketName = 'idr-audit-app'; // Your GCS bucket name

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
  const files = req.body.files; // Assuming files are included in the request body

  try {
    let existingHeaders = await getExistingHeaders(csvFilePath);
    let newHeaders = Object.keys(surveyData);

    // Add new headers if they are not already present
    newHeaders.forEach(header => {
      if (!existingHeaders.includes(header)) {
        existingHeaders.push(header);
      }
    });

    // Upload files to GCS
    const uploadedFileUrls = [];
    for (let file of files) {
      const { filename, content } = file; // Assuming file content is base64 encoded
      const buffer = Buffer.from(content, 'base64');
      const blob = storage.bucket(bucketName).file(filename);
      const blobStream = blob.createWriteStream({
        resumable: false,
        contentType: 'image/jpeg' // Adjust based on file type
      });

      await new Promise((resolve, reject) => {
        blobStream.on('error', reject);
        blobStream.on('finish', resolve);
        blobStream.end(buffer);
      });

      const publicUrl = `https://storage.googleapis.com/${bucketName}/${filename}`;
      uploadedFileUrls.push(publicUrl);
    }

    // Add file URLs to survey data
    surveyData.fileUrls = uploadedFileUrls;

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
    console.error('Error writing to CSV file or uploading files to GCS', error);
    res.status(500).send('Error saving survey data');
  }
});

app.get('/download-csv', (req, res) => {
  const filePath = path.join(__dirname, 'audit_data.csv');
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'audit_data.csv', (err) => {
      if (err) {
        console.error('Error downloading CSV file', err);
        res.status(500).send('Error downloading CSV file');
      }
    });
  } else {
    res.status(404).send('CSV file not found');
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
