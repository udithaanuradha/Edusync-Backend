const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// 1. Connect to your Cloudinary account using the keys from your .env
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

console.log('🔧 Cloudinary Config:');
console.log(`   Cloud Name: ${process.env.CLOUDINARY_CLOUD_NAME}`);
console.log(`   API Key: ${process.env.CLOUDINARY_API_KEY ? '✅ Set' : '❌ Missing'}`);
console.log(`   API Secret: ${process.env.CLOUDINARY_API_SECRET ? '✅ Set' : '❌ Missing'}`);

// 2. Setup the storage engine
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Determine if the file is an image or a document based on its extension
    const ext = file.originalname.split('.').pop().toLowerCase();
    const isImage = ['jpg', 'jpeg', 'png'].includes(ext);

    return {
      folder: 'edusync_guidelines',
      // Images process as 'image', everything else (PDFs, DOCX, XLSX) processes as 'raw'
      resource_type: isImage ? 'image' : 'raw', 
      
      // Note: We removed 'allowed_formats' from here because your 
      // multer fileFilter (below) is already perfectly handling the security!
    };
  },
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit is generous and safe
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf|jpeg|jpg|png|doc|docx|txt|xls|xlsx|ppt|pptx/;
    const extname = allowedTypes.test(file.originalname.split('.').pop().toLowerCase());
    
    if (extname) {
      return cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.originalname}`));
    }
  }
});

module.exports = { cloudinary, upload };