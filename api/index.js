// api/submit.js and api/[route].js - Vercel Serverless Functions
// Uses Snowflake EXTERNALBROWSER authentication (no password needed)

const snowflake = require('snowflake-sdk');

// Snowflake connection - EXTERNALBROWSER auth
const sfConnection = snowflake.createConnection({
  account: process.env.SNOWFLAKE_ACCOUNT || 'SIPNVNH-YQ43144',
  user: process.env.SNOWFLAKE_USER || 'MOHAMMED.NIHAL@ZERONORTH.COM',
  authenticator: 'EXTERNALBROWSER',  // ← Uses browser-based auth
  warehouse: process.env.SNOWFLAKE_WAREHOUSE || 'COMPUTE_WH',
  database: 'DEV_PLAYGROUND',
  schema: 'VESOP_ARENA'
});

// Connect once
sfConnection.connect((err, conn) => {
  if (err) {
    console.error('Snowflake connection error:', err.message);
  } else {
    console.log('✓ Connected to Snowflake');
  }
});

// Helper function to execute SQL
function querySF(sql, params = []) {
  return new Promise((resolve, reject) => {
    sfConnection.execute({
      sqlText: sql,
      binds: params || [],
      complete: (err, stmt, rows) => {
        if (err) {
          console.error('SQL Error:', err);
          reject(err);
        } else {
          resolve(rows || []);
        }
      }
    });
  });
}

// ═══════════════════════════════════════
// VERCEL HANDLER - Main API Router
// ═══════════════════════════════════════

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);

    // ═══════════════════════════════════════
    // ROUTES
    // ═══════════════════════════════════════

    // GET /api/health
    if (pathname === '/api/health') {
      return res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        snowflake: 'connected',
        account: 'SIPNVNH-YQ43144'
      });
    }

    // GET /api/submissions - Fetch all MCR data from Snowflake
    if (pathname === '/api/submissions' && req.method === 'GET') {
      try {
        const rows = await querySF(`
          SELECT 
            *
          FROM DEV_PLAYGROUND.VESOP_ARENA.MCR_SHEET_DATA
          ORDER BY CREATED_AT DESC
          LIMIT 500
        `);
        return res.status(200).json(rows || []);
      } catch (err) {
        return res.status(500).json({ error: 'Failed to fetch submissions', details: err.message });
      }
    }

    // POST /api/submit - New vessel submission
    if (pathname === '/api/submit' && req.method === 'POST') {
      try {
        const body = JSON.parse(req.body || '{}');
        const refId = `ZN-MCR-${body.imo}-${String(Date.now()).slice(-4)}`;

        const insertSQL = `
          INSERT INTO DEV_PLAYGROUND.VESOP_ARENA.MCR_SHEET_DATA (
            ID, VESSEL_NAME, IMO, VESSEL_TYPE, DWT, YOB, VESSEL_EMAIL,
            MCR_KW, MCR_RPM, DESIGN_DRAFT, BALLAST_DRAFT, AE_CONSUMPTION,
            SCRUBBER, CPP, STATUS, RECEIVED_DATE, SUBMITTED_BY, SUBMITTER_EMAIL,
            COMPANY, NOTES, SOURCE, REF_ID, CREATED_AT
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP())
        `;

        const params = [
          refId,
          body.name || 'Unknown Vessel',
          body.imo,
          body.type || '',
          body.dwt || 0,
          body.yob || 0,
          body.vemail || '',
          body.mcrKw || 0,
          body.mcrRpm || 0,
          body.desD || 0,
          body.balD || 0,
          body.ae || 0,
          body.scrub || 'No',
          body.cpp || 'No',
          'New',
          body.recvd || new Date().toISOString().split('T')[0],
          body.subname || 'API Submission',
          body.subemail || '',
          body.company || '',
          body.notes || '',
          'api',
          refId
        ];

        await querySF(insertSQL, params);

        return res.status(200).json({
          success: true,
          refId,
          message: `Vessel ${body.name} (IMO ${body.imo}) submitted successfully`
        });
      } catch (err) {
        console.error('Submit error:', err);
        return res.status(500).json({ error: 'Failed to submit', details: err.message });
      }
    }

    // PUT /api/update-status - Update MCR status
    if (pathname === '/api/update-status' && req.method === 'PUT') {
      try {
        const body = JSON.parse(req.body || '{}');
        const { imo, status } = body;

        if (!imo || !status) {
          return res.status(400).json({ error: 'IMO and status required' });
        }

        const updateSQL = `
          UPDATE DEV_PLAYGROUND.VESOP_ARENA.MCR_SHEET_DATA
          SET STATUS = ?, UPDATED_AT = CURRENT_TIMESTAMP()
          WHERE IMO = ?
        `;

        await querySF(updateSQL, [status, imo]);

        return res.status(200).json({ 
          success: true, 
          message: `Status updated to "${status}" for IMO ${imo}` 
        });
      } catch (err) {
        return res.status(500).json({ error: 'Failed to update status', details: err.message });
      }
    }

    // GET /api/export-csv - Export all submissions as CSV
    if (pathname === '/api/export-csv' && req.method === 'GET') {
      try {
        const rows = await querySF(`
          SELECT 
            VESSEL_NAME, IMO, VESSEL_TYPE, DWT, MCR_KW, MCR_RPM,
            DESIGN_DRAFT, BALLAST_DRAFT, AE_CONSUMPTION,
            SCRUBBER, CPP, STATUS, RECEIVED_DATE, SUBMITTED_BY, SUBMITTER_EMAIL
          FROM DEV_PLAYGROUND.VESOP_ARENA.MCR_SHEET_DATA
          ORDER BY CREATED_AT DESC
        `);

        if (!rows || rows.length === 0) {
          return res.status(200).send('No data to export');
        }

        const headers = ['Vessel Name', 'IMO', 'Type', 'DWT', 'MCR kW', 'MCR RPM', 'Design Draft', 'Ballast Draft', 'AE Cons', 'Scrubber', 'CPP', 'Status', 'Received', 'Submitter', 'Email'];
        const csvContent = [
          headers.join(','),
          ...rows.map(row => [
            row.VESSEL_NAME,
            row.IMO,
            row.VESSEL_TYPE,
            row.DWT,
            row.MCR_KW,
            row.MCR_RPM,
            row.DESIGN_DRAFT,
            row.BALLAST_DRAFT,
            row.AE_CONSUMPTION,
            row.SCRUBBER,
            row.CPP,
            row.STATUS,
            row.RECEIVED_DATE,
            row.SUBMITTED_BY,
            row.SUBMITTER_EMAIL
          ].map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="zn_mcr_${new Date().toISOString().split('T')[0]}.csv"`);
        return res.status(200).send(csvContent);
      } catch (err) {
        return res.status(500).json({ error: 'Failed to export CSV', details: err.message });
      }
    }

    // POST /api/parse-email - Parse email submission
    if (pathname === '/api/parse-email' && req.method === 'POST') {
      try {
        const body = JSON.parse(req.body || '{}');
        const emailText = body.emailText || '';

        const extract = (pattern) => {
          const m = emailText.match(pattern);
          return m ? m[1].trim() : '';
        };

        const imo = extract(/(?:IMO[:\s]+)(\d{7})/i);
        if (!imo) {
          return res.status(400).json({ error: 'Could not extract IMO from email' });
        }

        // Check if already exists
        const existing = await querySF(
          `SELECT ID FROM DEV_PLAYGROUND.VESOP_ARENA.MCR_SHEET_DATA WHERE IMO = ?`,
          [imo]
        );

        if (existing && existing.length > 0) {
          return res.status(400).json({ error: `Vessel with IMO ${imo} already exists` });
        }

        const refId = `ZN-${imo}-${String(Date.now()).slice(-4)}`;
        const insertSQL = `
          INSERT INTO DEV_PLAYGROUND.VESOP_ARENA.MCR_SHEET_DATA (
            ID, VESSEL_NAME, IMO, VESSEL_TYPE, DWT, YOB,
            MCR_KW, MCR_RPM, DESIGN_DRAFT, BALLAST_DRAFT, AE_CONSUMPTION,
            SCRUBBER, CPP, STATUS, RECEIVED_DATE, SUBMITTED_BY, SUBMITTER_EMAIL,
            NOTES, SOURCE, REF_ID, CREATED_AT
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP())
        `;

        const params = [
          refId,
          extract(/(?:Vessel Name[:\s]+)([^\n]+)/i) || 'From Email',
          imo,
          extract(/(?:Type[:\s]+)([^\n]+)/i) || '',
          parseFloat(extract(/(?:DWT[:\s]+)([\d.]+)/i) || '0'),
          parseInt(extract(/(?:Year|YOB[:\s]+)(\d{4})/i) || '0'),
          parseFloat(extract(/(?:MCR|Power[:\s]+)([\d.]+)/i) || '0'),
          parseInt(extract(/(?:RPM[:\s]+)(\d+)/i) || '0'),
          parseFloat(extract(/(?:Design Draft[:\s]+)([\d.]+)/i) || '0'),
          parseFloat(extract(/(?:Ballast Draft[:\s]+)([\d.]+)/i) || '0'),
          parseFloat(extract(/(?:AE Cons[:\s]+)([\d.]+)/i) || '0'),
          extract(/(?:Scrubber[:\s]+)(Yes|No)/i) || 'No',
          extract(/(?:CPP[:\s]+)(Yes|No)/i) || 'No',
          'New',
          new Date().toISOString().split('T')[0],
          extract(/(?:Submitted By[:\s]+)([^\n]+)/i) || 'Via Email',
          extract(/([^\s]+@[^\s]+)/i) || '',
          'Imported from email submission',
          'email',
          refId
        ];

        await querySF(insertSQL, params);

        return res.status(200).json({
          success: true,
          refId,
          message: `Imported from email submission`
        });
      } catch (err) {
        console.error('Parse email error:', err);
        return res.status(500).json({ error: 'Failed to parse email', details: err.message });
      }
    }

    return res.status(404).json({ error: 'Endpoint not found' });

  } catch (err) {
    console.error('Unhandled error:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
};
