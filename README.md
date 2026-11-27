# CFS Stock Desk (web app)

Reads shipper documents (Excel, PDF, scanned PDF), checks them, learns each shipper's format and keeps the
CFS stock report (Excel, one sheet per customer).

* Everything runs **inside the browser** on each PC. Documents and stock data are **never uploaded** – this
  website only delivers the program files.
* Works **offline** after the first visit. Install it from Edge or Chrome ("Install app").
* No client data is stored in this repository. Shipper formats are shared between PCs as files.

Open source components: SheetJS, ExcelJS, pdf.js, PDFium (EmbedPDF build), Tesseract.js – licences in `THIRD_PARTY_LICENSES.txt`.
