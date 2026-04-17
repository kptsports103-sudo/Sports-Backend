const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const {
  issueCertificate,
  verifyCertificate,
  listIssuedCertificates,
} = require('../controllers/certificate.controller');
const { generateCertificatePDF } = require('../services/pdfService');

router.get('/verify/:id', verifyCertificate);
router.get('/', authMiddleware, roleMiddleware(['creator', 'admin', 'superadmin']), listIssuedCertificates);
router.post('/issue', authMiddleware, roleMiddleware(['admin', 'superadmin']), issueCertificate);
router.post('/save', authMiddleware, roleMiddleware(['admin', 'superadmin']), issueCertificate);

// ============================================
// ENTERPRISE V5 - BACKEND PDF GENERATION
// ============================================
// Generate PDF on server (for bulk/enterprise usage)
router.post('/generate-pdf', authMiddleware, roleMiddleware(['admin', 'superadmin']), async (req, res) => {
  try {
    const { certificateData } = req.body || {};
    if (!certificateData || typeof certificateData !== 'object') {
      return res.status(400).json({ message: 'certificateData required' });
    }
    const pdfBuffer = await generateCertificatePDF(certificateData);

    // Send PDF as response
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuffer.length,
    });

    res.send(pdfBuffer);
  } catch (error) {
    console.error('PDF Generation Error:', error);
    res.status(500).json({ message: 'Failed to generate PDF' });
  }
});

// Generate PDF with data from database (secure - only server-side data)
router.post('/generate-pdf/secure', authMiddleware, roleMiddleware(['admin', 'superadmin']), async (req, res) => {
  try {
    const { studentId, year, competition, position } = req.body;

    if (!studentId || !year) {
      return res.status(400).json({ message: 'studentId and year required' });
    }

    // Get certificate data from database (secure)
    const Certificate = require('../models/certificate.model');
    const certificate = await Certificate.findOne({
      studentId,
      year,
      competition,
      position,
    });

    if (!certificate) {
      return res.status(404).json({ message: 'Certificate not found' });
    }

    // Generate QR code
    const QRCode = require('qrcode');
    const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:5176'}/verify/${certificate.certificateId}`;
    const qrImage = await QRCode.toDataURL(verifyUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 220,
    });

    // Generate PDF
    const pdfBuffer = await generateCertificatePDF({
      name: certificate.name,
      kpmNo: certificate.kpmNo,
      semester: certificate.semester,
      department: certificate.department,
      competition: certificate.competition,
      position: certificate.position,
      year: certificate.year,
      certificateId: certificate.certificateId,
      qrImage,
      backgroundUrl: process.env.CERTIFICATE_TEMPLATE_URL || '/certificate-template.jpeg',
    });

    // Send PDF
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=certificate-${certificate.certificateId}.pdf`,
      'Content-Length': pdfBuffer.length,
    });

    res.send(pdfBuffer);
  } catch (error) {
    console.error('Secure PDF Generation Error:', error);
    res.status(500).json({ message: 'Failed to generate PDF' });
  }
});

module.exports = router;
