const multer = require('multer');

const storage = multer.memoryStorage();

const documentUpload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/jpg'
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error('Only PDF, DOC, DOCX, JPG, PNG allowed'), false);
    }

    cb(null, true);
  }
});

module.exports = documentUpload;