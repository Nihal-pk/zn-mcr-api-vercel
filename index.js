const snowflake = require('snowflake-sdk');
const sfConnection = snowflake.createConnection({
  account: process.env.SNOWFLAKE_ACCOUNT || 'SIPNVNH-YQ43144',
  user: process.env.SNOWFLAKE_USER || 'MOHAMMED.NIHAL@ZERONORTH.COM',
  authenticator: 'EXTERNALBROWSER',
  warehouse: process.env.SNOWFLAKE_WAREHOUSE || 'COMPUTE_WH',
  database: 'DEV_PLAYGROUND',
  schema: 'VESOP_ARENA'
});
sfConnection.connect((err, conn) => {
  if (err) {
    console.error('Snowflake connection error:', err.message);
  } else {
    console.log('✓ Connected to Snowflake');
  }
});
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
module.exports = async (req, res) => {
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
    if (pathname === '/api/health') {
      return res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        snowflake: 'connected',
        account: 'SIPNVNH-YQ43144'
      });
    }
    if (pathname === '/api/submissions' && req.method === 'GET') {
      try {
        const rows = await querySF(`
          SELECT * FROM DEV_PLAYGROUND.VESOP_ARENA.MCR_SHEET_DATA
          ORDER BY CREATED_AT DESC LIMIT 500
        `);
        return res.status(200).json(rows || []);
      } catch (err) {
        return res.status(500).json({ error: 'Failed to fetch submissions', details: err.message });
      }
    }
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
        const params = [refId, body.name || 'Unknown', body.imo, body.type || '', body.dwt || 0, body.yob || 0, body.vemail || '', body.mcrKw || 0, body.mcrRpm || 0, body.desD || 0, body.balD || 0, body.ae || 0, body.scrub || 'No', body.cpp || 'No', 'New', body.recvd || new Date().toISOString().split('T')[0], body.subname || 'API', body.subemail || '', body.company || '', body.notes || '', 'api', refId];
        await querySF(insertSQL, params);
        return res.status(200).json({ success: true, refId, message: `Vessel submitted` });
      } catch (err) {
        return res.status(500).json({ error: 'Failed to submit', details: err.message });
      }
    }
    if (pathname === '/api/update-status' && req.method === 'PUT') {
      try {
        const body = JSON.parse(req.body || '{}');
        const { imo, status } = body;
        if (!imo || !status) return res.status(400).json({ error: 'IMO and status required' });
        
        await querySF(`UPDATE DEV_PLAYGROUND.VESOP_ARENA.MCR_SHEET_DATA SET STATUS = ?, UPDATED_AT = CURRENT_TIMESTAMP() WHERE IMO = ?`, [status, imo]);
        return res.status(200).json({ success: true, message: `Status updated` });
      } catch (err) {
        return res.status(500).json({ error: 'Failed to update', details: err.message });
      }
    }
    if (pathname === '/api/export-csv' && req.method === 'GET') {
      try {
        const rows = await querySF(`SELECT VESSEL_NAME, IMO, VESSEL_TYPE, DWT, MCR_KW, MCR_RPM, DESIGN_DRAFT, BALLAST_DRAFT, AE_CONSUMPTION, SCRUBBER, CPP, STATUS, RECEIVED_DATE, SUBMITTED_BY, SUBMITTER_EMAIL FROM DEV_PLAYGROUND.VESOP_ARENA.MCR_SHEET_DATA ORDER BY CREATED_AT DESC`);
        if (!rows || rows.length === 0) return res.status(200).send('No data');
        
        const headers = ['Vessel Name', 'IMO', 'Type', 'DWT', 'MCR kW', 'MCR RPM', 'Design Draft', 'Ballast Draft', 'AE Cons', 'Scrubber', 'CPP', 'Status', 'Received', 'Submitter', 'Email'];
        const csvContent = [headers.join(','), ...rows.map(row => [row.VESSEL_NAME, row.IMO, row.VESSEL_TYPE, row.DWT, row.MCR_KW, row.MCR_RPM, row.DESIGN_DRAFT, row.BALLAST_DRAFT, row.AE_CONSUMPTION, row.SCRUBBER, row.CPP, row.STATUS, row.RECEIVED_DATE, row.SUBMITTED_BY, row.SUBMITTER_EMAIL].map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))].join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="zn_mcr_${new Date().toISOString().split('T')[0]}.csv"`);
        return res.status(200).send(csvContent);
      } catch (err) {
        return res.status(500).json({ error: 'Export failed', details: err.message });
      }
    }
    return res.status(404).json({ error: 'Endpoint not found' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal error', details: err.message });
  }
};