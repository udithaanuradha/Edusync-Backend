const dotenv = require('dotenv');
dotenv.config();

const { v2: cloudinary } = require('cloudinary');
const multer = require('multer');
const stream = require('stream');

let cloudName = process.env.CLOUDINARY_CLOUD_NAME;
let apiKey = process.env.CLOUDINARY_API_KEY;
let apiSecret = process.env.CLOUDINARY_API_SECRET;
let cloudinaryUrl = process.env.CLOUDINARY_URL;

if (cloudinaryUrl && (!cloudName || !apiKey || !apiSecret)) {
  try {
    const parsedUrl = new URL(cloudinaryUrl);
    const username = parsedUrl.username || '';
    const password = parsedUrl.password || '';
    const host = parsedUrl.host || '';
    if (!cloudName && host) {
      cloudName = host;
    }
    if (!apiKey && username) {
      apiKey = username;
    }
    if (!apiSecret && password) {
      apiSecret = password;
    }
  } catch (error) {
    console.error('❌ Failed to parse CLOUDINARY_URL:', error.message);
  }
}

if (!cloudName || !apiKey || !apiSecret) {
  console.error('❌ Cloudinary environment variables are missing or incomplete.');
  console.error(`   CLOUDINARY_CLOUD_NAME: ${cloudName ? '✅ Set' : '❌ Missing'}`);
  console.error(`   CLOUDINARY_API_KEY: ${apiKey ? '✅ Set' : '❌ Missing'}`);
  console.error(`   CLOUDINARY_API_SECRET: ${apiSecret ? '✅ Set' : '❌ Missing'}`);
} else {
  console.log('ℹ️ Cloudinary credentials loaded.');
}

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
  secure: true,
  url: cloudinaryUrl,
});

const normalizeCloudinaryError = (error) => {
  if (!error) return 'Unknown Cloudinary error';
  if (error.message?.includes('Invalid api_key')) {
    return 'Cloudinary authentication failed. Check CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in your environment.';
  }
  if (error.message?.includes('Invalid cloud_name')) {
    return 'Cloudinary cloud name is invalid. Check CLOUDINARY_CLOUD_NAME in your environment.';
  }
  return error.message || 'Cloudinary upload failed';
};

console.log('🔧 Cloudinary Config:');
console.log(`   Cloud Name: ${cloudName || 'undefined'}`);
console.log(`   API Key: ${apiKey ? '✅ Set' : '❌ Missing'}`);
console.log(`   API Secret: ${apiSecret ? '✅ Set' : '❌ Missing'}`);
if (cloudinaryUrl) {
  console.log('   CLOUDINARY_URL: ✅ Set');
} else {
  console.log('   CLOUDINARY_URL: optional (not set)');
}

const storage = multer.memoryStorage();
const defaultCloudFolder = process.env.CLOUDINARY_STUDENT_SUBMISSION_FOLDER || process.env.CLOUDINARY_SUBMISSION_FOLDER || process.env.CLOUDINARY_STAGE_FOLDER || process.env.CLOUDINARY_FOLDER || 'student-submissions';

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit is generous and safe
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf|jpeg|jpg|png|doc|docx|txt|xls|xlsx|ppt|pptx|zip|rar/;
    const extname = allowedTypes.test(file.originalname.split('.').pop().toLowerCase());

    if (extname) {
      return cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.originalname}`));
    }
  }
});

const uploadBufferToCloudinary = (buffer, originalName, folder = defaultCloudFolder) => {
  return new Promise((resolve, reject) => {
    const safeName = (originalName || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_');
    const bufferStream = new stream.PassThrough();
    bufferStream.end(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || ''));

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'auto',
        public_id: `${Date.now()}-${safeName.replace(/\.[^/.]+$/, '')}`,
        overwrite: false,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      }
    );

    bufferStream.pipe(uploadStream);
  });
};

module.exports = { cloudinary, upload, uploadBufferToCloudinary };