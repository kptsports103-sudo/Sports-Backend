/**
 * ============================================
 * ENTERPRISE PDF RENDERING SERVICE
 * ============================================
 * Backend PDF generation using Puppeteer
 * Used for bulk certificate generation
 */

const puppeteer = require("puppeteer");

// Certificate dimensions
const CERT_WIDTH = 1394;
const CERT_HEIGHT = 2048;
const DEFAULT_FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

let browserInstance = null;

const closeBrowser = async () => {
  if (!browserInstance) return;
  try {
    await browserInstance.close();
  } catch (error) {
    console.error("Failed to close Puppeteer browser:", error);
  } finally {
    browserInstance = null;
  }
};

async function getBrowser() {
  if (browserInstance) return browserInstance;
  browserInstance = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
  return browserInstance;
}

process.once("SIGINT", closeBrowser);
process.once("SIGTERM", closeBrowser);
process.once("beforeExit", closeBrowser);

const pxToIn = (px) => `${Number(px) / 96}in`;

const resolveAbsoluteUrl = (url) => {
  const value = String(url || "").trim();
  if (!value) return `${DEFAULT_FRONTEND_URL}/certificate-template.jpeg`;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `${DEFAULT_FRONTEND_URL}${value}`;
  return `${DEFAULT_FRONTEND_URL}/${value}`;
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

/**
 * Generate PDF from HTML using Puppeteer
 * @param {string} html - HTML content to render
 * @param {object} options - PDF generation options
 * @returns {Promise<Buffer>} - PDF buffer
 */
async function generatePDF(html, options = {}) {
  const {
    width = CERT_WIDTH,
    height = CERT_HEIGHT,
  } = options;

  let page = null;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    // Set viewport to match certificate size
    await page.setViewport({
      width: Math.floor(width),
      height: Math.floor(height),
      deviceScaleFactor: 1,
    });

    // Set the HTML content
    await page.setContent(html, {
      waitUntil: "networkidle0",
      timeout: 60000,
    });

    // Wait for any fonts to load
    await page.evaluateHandle("document.fonts.ready");

    // Generate PDF
    const pdfBuffer = await page.pdf({
      width: pxToIn(width),
      height: pxToIn(height),
      scale: 1,
      printBackground: true,
      margin: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
    });

    return pdfBuffer;
  } catch (error) {
    console.error("PDF Generation Error:", error);
    throw error;
  } finally {
    if (page && !page.isClosed()) await page.close();
  }
}

/**
 * Generate certificate PDF with data
 * @param {object} certificateData - Certificate data
 * @returns {Promise<Buffer>} - PDF buffer
 */
async function generateCertificatePDF(certificateData) {
  const {
    name,
    kpmNo,
    semester,
    department,
    competition,
    position,
    year,
    certificateId,
    qrImage,
    backgroundUrl,
  } = certificateData;

  // Build HTML for certificate
  const html = buildCertificateHTML({
    name,
    kpmNo,
    semester,
    department,
    competition,
    position,
    year,
    certificateId,
    qrImage,
    backgroundUrl,
  });

  return generatePDF(html);
}

/**
 * Build certificate HTML
 */
function buildCertificateHTML(data) {
  const { name, kpmNo, semester, department, competition, position, year, certificateId, qrImage, backgroundUrl } = data;
  const safeBackgroundUrl = resolveAbsoluteUrl(backgroundUrl);
  const slotDebug = String(process.env.CERTIFICATE_SLOT_DEBUG || "").toLowerCase() === "true";
  const configuredFontUrl = String(process.env.CERTIFICATE_FONT_URL || "").trim();
  const fontUrl = configuredFontUrl ? resolveAbsoluteUrl(configuredFontUrl) : "";
  const fontFaceCss = fontUrl
    ? `
        @font-face {
          font-family: "TimesNewRomanLocal";
          src: url('${fontUrl}') format("truetype");
          font-style: normal;
          font-weight: 400 700;
        }
      `
    : "";

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        ${fontFaceCss}

        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          width: 1394px;
          height: 2048px;
          font-family: ${fontUrl ? '"TimesNewRomanLocal", ' : ""}"Times New Roman", serif;
          overflow: hidden;
        }
        
        .certificate {
          width: 1394px;
          height: 2048px;
          position: relative;
          background-image: url('${safeBackgroundUrl}');
          background-repeat: no-repeat;
          background-position: 0 0;
          background-size: 100% 100%;
        }
        
        .field {
          position: absolute;
          color: #243a8c;
          font-weight: 700;
          font-size: 34px;
          white-space: nowrap;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
          padding-bottom: 0;
          ${slotDebug ? "outline: 1px dashed rgba(255,0,0,.6);" : ""}
          ${slotDebug ? "background: rgba(255,0,0,.06);" : ""}
        }
        
        .kpm {
          left: 450px;
          top: 835px;
          width: 250px;
          height: 50px;
          font-size: 26px;
          justify-content: flex-start;
        }
        
        .name {
          left: 697px;
          top: 1080px;
          width: 550px;
          height: 80px;
          font-size: 52px;
          justify-content: center;
          text-align: center;
        }
        
        .semester {
          left: 360px;
          top: 1240px;
          width: 120px;
          height: 60px;
          justify-content: center;
        }
        
        .department {
          left: 697px;
          top: 1230px;
          width: 360px;
          height: 60px;
          justify-content: center;
          text-align: center;
        }
        
        .competition {
          left: 675px;
          top: 1320px;
          width: 360px;
          height: 60px;
          font-size: 28px;
          justify-content: flex-start;
        }
        
        .year {
          left: 1040px;
          top: 1430px;
          width: 220px;
          height: 60px;
          justify-content: center;
        }
        
        .position {
          left: 697px;
          top: 1530px;
          width: 230px;
          height: 60px;
          justify-content: center;
          text-align: center;
        }
        
        .qr-code {
          position: absolute;
          bottom: 130px;
          right: 220px;
          width: 170px;
          height: 170px;
          border: 4px solid #ffffff;
          border-radius: 6px;
          box-shadow: 0 8px 24px rgba(10, 20, 65, 0.25);
          background: #fff;
        }
      </style>
    </head>
    <body>
      <div class="certificate">
        <div class="field kpm">${escapeHtml(kpmNo)}</div>
        <div class="field name">${escapeHtml(name)}</div>
        <div class="field semester">${escapeHtml(semester)}</div>
        <div class="field department">${escapeHtml(department)}</div>
        <div class="field competition">${escapeHtml(competition)}</div>
        <div class="field year">${escapeHtml(year)}</div>
        <div class="field position">${escapeHtml(position)}</div>
        ${qrImage ? `<img class="qr-code" src="${escapeHtml(qrImage)}" alt="QR Code" />` : ""}
      </div>
    </body>
    </html>
  `;
}

module.exports = {
  generatePDF,
  generateCertificatePDF,
  buildCertificateHTML,
  CERT_WIDTH,
  CERT_HEIGHT,
};
