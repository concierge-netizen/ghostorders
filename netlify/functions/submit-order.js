// netlify/functions/submit-order.js
// Handles form submission: creates monday.com item + subitems,
// then sends confirmation emails to client and internal team via Gmail SMTP.
//
// Required environment variables (set in Netlify → Site config → Environment variables):
//   MONDAY_TOKEN    — your monday.com API token
//   RESEND_KEY      — Resend API key (resend.com — free, 100 emails/day)
//   INTERNAL_EMAIL  — (optional) defaults to concierge@handslogistics.com
//   INTERNAL_EMAIL  — (optional) defaults to concierge@handslogistics.com

// Email via Resend API (resend.com) — free tier, no SMTP needed

const MONDAY_TOKEN    = process.env.MONDAY_TOKEN;
const RESEND_KEY      = process.env.RESEND_KEY;
const INTERNAL_EMAIL  = process.env.INTERNAL_EMAIL || 'concierge@handslogistics.com';
const BOARD_ID        = '4550650855';
const GROUP_ID        = 'new_group84798';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

// ─── monday GraphQL helper ───────────────────────────────────────────────────
async function mq(query) {
  const res = await fetch('https://api.monday.com/v2', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': MONDAY_TOKEN,
      'API-Version':   '2023-04'
    },
    body: JSON.stringify({ query })
  });
  const data = await res.json();
  if (data.errors) throw new Error('monday: ' + data.errors[0].message);
  return data.data;
}

// ─── Resend email helper ─────────────────────────────────────────────────────
async function sendEmail(to, subject, html, fromName) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + RESEND_KEY,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify({
      from:    (fromName || 'HANDS Logistics') + ' <onboarding@resend.dev>',
      to:      [to],
      subject: subject,
      html:    html
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Resend error: ' + JSON.stringify(data));
  return data;
}

// ─── Shared style constants ──────────────────────────────────────────────────
const GREEN  = '#a0d6b4';
const BLACK  = '#080808';
const DARK   = '#101010';
const BORDER = '#1e1e1e';

// ─── CLIENT confirmation email ───────────────────────────────────────────────
function clientHTML(d, itemId) {
  const lineRows = d.lineItems.length
    ? d.lineItems.map(li =>
        '<tr>' +
        td('padding:8px 12px;border-bottom:1px solid ' + BORDER + ';font-family:monospace;font-size:11px;color:' + GREEN, li.sku || '&mdash;') +
        td('padding:8px 12px;border-bottom:1px solid ' + BORDER + ';font-size:13px;color:#cccccc', li.desc || '') +
        td('padding:8px 12px;border-bottom:1px solid ' + BORDER + ';text-align:center;font-size:13px;color:#cccccc', li.qty || '0') +
        td('padding:8px 12px;border-bottom:1px solid ' + BORDER + ';text-align:right;font-size:13px;color:#cccccc', li.price ? '$' + parseFloat(li.price).toFixed(2) : '&mdash;') +
        '</tr>'
      ).join('')
    : '<tr>' + td('padding:12px;color:#555;font-size:12px;text-align:center', 'No line items', 4) + '</tr>';

  return wrap(BLACK,
    stripe() +
    // header
    row('<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
      '<td><div style="font-size:9px;letter-spacing:3px;color:#555;font-family:monospace;text-transform:uppercase;margin-bottom:4px;">Fulfilled by</div>' +
      '<div style="font-size:20px;font-weight:700;letter-spacing:3px;color:' + GREEN + ';font-family:monospace;">HANDS LOGISTICS</div></td>' +
      '<td align="right" valign="top">' +
        '<div style="font-size:9px;letter-spacing:1px;color:#555;font-family:monospace;text-transform:uppercase;">Reference</div>' +
        '<div style="font-size:14px;font-weight:700;color:#fff;font-family:monospace;">#' + itemId + '</div>' +
      '</td></tr></table>', '26px 32px 20px') +
    // greeting
    row('<p style="margin:0 0 10px;font-size:15px;color:#fff;">Hi ' + (d.clientName || 'there') + ',</p>' +
      '<p style="margin:0;font-size:13px;color:#888;line-height:1.7;">Your delivery request has been received. Our team will confirm within <strong style="color:' + GREEN + ';">3&ndash;4 business days</strong>. A separate invoice will be issued by Next Wave Beverages upon fulfillment.</p>',
      '0 32px 20px') +
    // order details
    row(infoTable(BLACK, [
      ['Account',       d.account],
      ['Project',       d.projectName],
      ['Delivery Date', (d.deliveryDate || '&mdash;') + (d.deliveryTime ? ' at ' + d.deliveryTime : '')],
      ['Address',       (d.deliveryAddress || '').replace(/\n/g, '<br>')],
      d.billingCode ? ['PO / Code', d.billingCode] : null
    ].filter(Boolean)), '0 32px 20px') +
    // line items
    row(
      '<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ' + BORDER + ';">' +
        '<tr style="background:#141414;">' +
          th('SKU') + th('Description') + th('Qty') + th('Unit', 'right') +
        '</tr>' +
        lineRows +
      '</table>', '0 32px 20px') +
    // notes
    (d.description || d.specialInstr
      ? row(infoTable(BLACK, [
          d.description  ? ['Notes',        d.description]  : null,
          d.specialInstr ? ['Special Instr', d.specialInstr] : null
        ].filter(Boolean)), '0 32px 20px')
      : '') +
    stripe() +
    row('<div style="font-size:9px;letter-spacing:1px;color:#444;font-family:monospace;line-height:2;">' +
      'HANDS Logistics &nbsp;&middot;&nbsp; concierge&#64;handslogistics&#46;com &nbsp;&middot;&nbsp; handslogistics&#46;com<br>' +
      '8540 Dean Martin Drive, Suite 160 &nbsp;&middot;&nbsp; Las Vegas, NV 89139</div>',
      '14px 32px', BLACK)
  );
}

// ─── INTERNAL team recap email ───────────────────────────────────────────────
function internalHTML(d, itemId) {
  const orderTotal = d.lineItems.reduce(
    (s, li) => s + (parseFloat(li.qty) || 0) * (parseFloat(li.price) || 0), 0
  );

  const lineRows = d.lineItems.length
    ? d.lineItems.map(li => {
        const t = (parseFloat(li.qty) || 0) * (parseFloat(li.price) || 0);
        return '<tr>' +
          td('padding:7px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px;color:#333', li.sku || '&mdash;') +
          td('padding:7px 12px;border-bottom:1px solid #eee;font-size:12px;color:#111', li.desc || '') +
          td('padding:7px 12px;border-bottom:1px solid #eee;text-align:center;font-size:12px;color:#111', li.qty || '0') +
          td('padding:7px 12px;border-bottom:1px solid #eee;text-align:right;font-size:12px;color:#111', li.price ? '$' + parseFloat(li.price).toFixed(2) : '&mdash;') +
          td('padding:7px 12px;border-bottom:1px solid #eee;text-align:right;font-size:12px;font-weight:600;color:#111', t ? '$' + t.toFixed(2) : '&mdash;') +
          '</tr>';
      }).join('')
    : '<tr>' + td('padding:10px 12px;color:#999;font-size:12px', 'No line items', 5) + '</tr>';

  return wrap('#f5f5f5',
    // dark header
    '<table width="620" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e0e0e0;max-width:620px;">' +
    stripe() +
    row('<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
      '<td><div style="font-size:9px;letter-spacing:3px;color:#555;font-family:monospace;text-transform:uppercase;margin-bottom:3px;">New Order</div>' +
        '<div style="font-size:18px;font-weight:700;letter-spacing:2px;color:' + GREEN + ';font-family:monospace;">HANDS LOGISTICS</div></td>' +
      '<td align="right" valign="middle">' +
        '<div style="background:' + GREEN + ';color:' + BLACK + ';font-family:monospace;font-size:11px;font-weight:700;padding:6px 14px;letter-spacing:1px;display:inline-block;">ORDER #' + itemId + '</div>' +
      '</td></tr></table>', '18px 28px', BLACK) +
    // client info
    sectionLight('Client Information',
      infoTableLight([
        ['Name',    d.clientName],
        ['Account', d.account],
        ['Email',   '<a href="mailto:' + (d.clientEmail || '') + '" style="color:' + GREEN + ';text-decoration:none;">' + (d.clientEmail || '&mdash;') + '</a>'],
        d.clientPhone ? ['Phone', d.clientPhone] : null
      ].filter(Boolean))) +
    // delivery info
    sectionLight('Delivery Details',
      infoTableLight([
        d.projectName   ? ['Project', d.projectName]  : null,
        ['Date',          (d.deliveryDate || '&mdash;') + (d.deliveryTime ? ' at ' + d.deliveryTime : '')],
        ['Address',       (d.deliveryAddress || '').replace(/\n/g, '<br>')],
        d.attn          ? ['Attn',    d.attn]          : null,
        d.billingCode   ? ['PO/Code', d.billingCode]   : null
      ].filter(Boolean))) +
    // line items
    '<tr><td style="padding:18px 28px 0;">' +
      '<div style="font-size:10px;letter-spacing:2px;color:#999;font-family:monospace;text-transform:uppercase;border-bottom:1px solid #eee;padding-bottom:6px;margin-bottom:10px;">Product Line Items</div>' +
      '<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;">' +
        '<tr style="background:#f9f9f9;">' +
          thLight('SKU') + thLight('Description') + thLight('Qty') + thLight('Unit', 'right') + thLight('Total', 'right') +
        '</tr>' +
        lineRows +
        (orderTotal
          ? '<tr style="background:' + BLACK + ';"><td colspan="4" style="padding:10px 12px;text-align:right;font-size:10px;color:' + GREEN + ';font-family:monospace;text-transform:uppercase;letter-spacing:1px;">Order Total</td>' +
            '<td style="padding:10px 12px;text-align:right;font-size:15px;font-weight:700;color:' + GREEN + ';font-family:monospace;">$' + orderTotal.toFixed(2) + '</td></tr>'
          : '') +
      '</table>' +
    '</td></tr>' +
    // notes
    (d.description || d.specialInstr
      ? '<tr><td style="padding:16px 28px 0;">' +
          '<div style="font-size:10px;letter-spacing:2px;color:#999;font-family:monospace;text-transform:uppercase;border-bottom:1px solid #eee;padding-bottom:6px;margin-bottom:10px;">Notes</div>' +
          (d.description  ? '<p style="margin:0 0 6px;font-size:12px;color:#555;line-height:1.6;"><strong style="color:#333;">Order Notes:</strong> ' + d.description + '</p>' : '') +
          (d.specialInstr ? '<p style="margin:0;font-size:12px;color:#555;line-height:1.6;"><strong style="color:#333;">Special Instructions:</strong> ' + d.specialInstr + '</p>' : '') +
        '</td></tr>'
      : '') +
    // monday link button
    '<tr><td style="padding:18px 28px;">' +
      '<a href="https://handslogistics.monday.com/boards/' + BOARD_ID + '/pulses/' + itemId + '" ' +
        'style="display:inline-block;background:' + GREEN + ';color:' + BLACK + ';font-family:monospace;font-size:11px;font-weight:700;padding:10px 20px;text-decoration:none;letter-spacing:1px;">' +
        'VIEW IN MONDAY &rarr;' +
      '</a>' +
    '</td></tr>' +
    stripe() +
    row('<div style="font-size:9px;letter-spacing:1px;color:#444;font-family:monospace;">' +
      'HANDS Logistics &nbsp;&middot;&nbsp; concierge&#64;handslogistics&#46;com &nbsp;&middot;&nbsp; Las Vegas, NV 89139</div>',
      '14px 28px', BLACK) +
    '</table>',
    true // light wrapper
  );
}

// ─── HTML helpers ────────────────────────────────────────────────────────────
function wrap(bg, content, light) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="margin:0;padding:0;background:' + (light ? '#f5f5f5' : bg) + ';font-family:Arial,sans-serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 16px;">' +
    (light ? content :
      '<table width="600" cellpadding="0" cellspacing="0" style="background:' + bg + ';border:1px solid #1e1e1e;max-width:600px;">' +
      content + '</table>') +
    '</td></tr></table></body></html>';
}
function stripe() {
  return '<tr><td style="height:3px;background:linear-gradient(90deg,' + BLACK + ' 68%,' + GREEN + ' 68%);font-size:0;">&nbsp;</td></tr>';
}
function row(content, padding, bg) {
  return '<tr><td style="padding:' + (padding || '20px 32px') + ';' + (bg ? 'background:' + bg + ';' : '') + '">' + content + '</td></tr>';
}
function td(style, content, colspan) {
  return '<td' + (colspan ? ' colspan="' + colspan + '"' : '') + ' style="' + style + '">' + content + '</td>';
}
function th(label, align) {
  return '<th style="padding:8px 14px;text-align:' + (align || 'left') + ';font-size:9px;letter-spacing:1.5px;color:' + GREEN + ';font-family:monospace;text-transform:uppercase;font-weight:normal;">' + label + '</th>';
}
function thLight(label, align) {
  return '<th style="padding:7px 12px;text-align:' + (align || 'left') + ';font-size:9px;color:#999;font-family:monospace;text-transform:uppercase;font-weight:normal;letter-spacing:1px;">' + label + '</th>';
}
function infoTable(bg, rows) {
  return '<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ' + BORDER + ';">' +
    '<tr><td colspan="2" style="padding:8px 14px;background:#141414;font-size:9px;letter-spacing:2px;color:' + GREEN + ';font-family:monospace;text-transform:uppercase;">Order Details</td></tr>' +
    rows.map((r, i) =>
      '<tr>' +
        '<td style="padding:9px 14px;border-bottom:' + (i < rows.length - 1 ? '1px solid ' + BORDER : 'none') + ';font-size:10px;color:#555;font-family:monospace;text-transform:uppercase;width:38%;vertical-align:top;">' + r[0] + '</td>' +
        '<td style="padding:9px 14px;border-bottom:' + (i < rows.length - 1 ? '1px solid ' + BORDER : 'none') + ';font-size:13px;color:#ccc;">' + (r[1] || '&mdash;') + '</td>' +
      '</tr>'
    ).join('') +
  '</table>';
}
function infoTableLight(rows) {
  return '<table width="100%" cellpadding="0" cellspacing="0">' +
    rows.map(r =>
      '<tr>' +
        '<td style="width:38%;font-size:10px;color:#999;font-family:monospace;text-transform:uppercase;padding:5px 0;vertical-align:top;">' + r[0] + '</td>' +
        '<td style="font-size:13px;color:#111;padding:5px 0;">' + (r[1] || '&mdash;') + '</td>' +
      '</tr>'
    ).join('') +
  '</table>';
}
function sectionLight(title, content) {
  return '<tr><td style="padding:18px 28px 0;">' +
    '<div style="font-size:10px;letter-spacing:2px;color:#999;font-family:monospace;text-transform:uppercase;border-bottom:1px solid #eee;padding-bottom:6px;margin-bottom:10px;">' + title + '</div>' +
    content +
  '</td></tr>';
}

// ─── Main handler ────────────────────────────────────────────────────────────
exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const d = JSON.parse(event.body);
    const {
      clientName, account, clientEmail, clientPhone,
      projectName, billingCode,
      deliveryAddress, deliveryDate, deliveryTime, attn,
      description, specialInstr,
      lineItems = []
    } = d;

    // ── 1. Build monday column values ──────────────────────────────────────
    const col = {
      text:    clientName   || '',
      text4:   account      || '',
      text5:   projectName  || '',
      text2:   deliveryDate || '',
      text9:   deliveryTime || '',
      text20:  billingCode  || '',
      color:   { label: 'Unconfirmed' },
      status:  { label: 'Unconfirmed' },
      status2: { label: 'NOT STARTED' }
    };
    if (clientEmail)     col.client_email1    = { email: clientEmail, text: clientEmail };
    if (clientPhone)     col.phone            = { phone: clientPhone.replace(/[^0-9]/g, ''), countryShortName: 'US' };
    if (deliveryAddress) col.long_text8       = { text: deliveryAddress };
    if (description)     col.long_text        = { text: description };
    const si = [attn ? 'Attn: ' + attn : '', specialInstr || ''].filter(Boolean).join('\n');
    if (si)              col.long_text_mm1qb1hz = { text: si };

    const itemName = [account, projectName, deliveryDate].filter(Boolean).join(' - ');

    // ── 2. Create monday parent item ───────────────────────────────────────
    const created = await mq(
      'mutation { create_item(' +
        'board_id: ' + BOARD_ID + ', ' +
        'group_id: "' + GROUP_ID + '", ' +
        'item_name: ' + JSON.stringify(itemName) + ', ' +
        'column_values: ' + JSON.stringify(JSON.stringify(col)) +
      ') { id } }'
    );
    const itemId = created.create_item.id;

    // ── 3. Create subitems ─────────────────────────────────────────────────
    for (const li of lineItems.filter(l => l.sku || l.desc)) {
      const sn  = li.sku ? li.sku + ' - ' + (li.desc || 'Product') : (li.desc || 'Product');
      const qty = parseFloat(li.qty)   || 0;
      const prc = parseFloat(li.price) || 0;
      const sc  = JSON.stringify({
        numbers: qty,
        text:    prc ? '$' + prc.toFixed(2) + ' ea - Total: $' + (qty * prc).toFixed(2) : 'Qty: ' + qty
      });
      await mq(
        'mutation { create_subitem(' +
          'parent_item_id: ' + itemId + ', ' +
          'item_name: ' + JSON.stringify(sn) + ', ' +
          'column_values: ' + JSON.stringify(sc) +
        ') { id } }'
      );
    }

    // ── 4. Post item update comment ────────────────────────────────────────
    const total    = lineItems.reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.price) || 0), 0);
    const lineDesc = lineItems.filter(l => l.sku || l.desc).map(l =>
      (l.sku ? l.sku + ' - ' : '') + l.desc + ' (x' + l.qty + (l.price ? ' @ $' + parseFloat(l.price).toFixed(2) : '') + ')'
    ).join('\n');

    const comment =
      'ORDER VIA GHOST ORDER FORM\n\n' +
      'Contact: ' + clientName + ' | ' + clientEmail + (clientPhone ? ' | ' + clientPhone : '') + '\n' +
      'Account: ' + account + '\n' +
      'Project: ' + projectName + '\n' +
      'Delivery: ' + deliveryDate + (deliveryTime ? ' at ' + deliveryTime : '') + '\n' +
      'Address: ' + deliveryAddress + '\n' +
      (attn        ? 'Attn: ' + attn + '\n'            : '') +
      (billingCode ? 'PO: '  + billingCode + '\n'      : '') +
      '\nLINE ITEMS\n' + lineDesc + '\n\n' +
      'ORDER TOTAL: $' + total.toFixed(2) +
      (description  ? '\n\nNotes: '   + description  : '') +
      (specialInstr ? '\nSpecial: '   + specialInstr : '');

    await mq('mutation { create_update(item_id: ' + itemId + ', body: ' + JSON.stringify(comment) + ') { id } }');

    // ── 5. Send emails via Resend ──────────────────────────────────────────
    const clientSubject   = 'Delivery Request Received - ' + (projectName || account) + (deliveryDate ? ' | ' + deliveryDate : '');
    const internalSubject = '[NEW ORDER #' + itemId + '] ' + account + ' - ' + (projectName || '') + (deliveryDate ? ' | ' + deliveryDate : '');

    const emailQueue = [];

    if (clientEmail) {
      emailQueue.push(sendEmail(clientEmail, clientSubject, clientHTML(d, itemId), 'HANDS Logistics'));
    }

    emailQueue.push(sendEmail(INTERNAL_EMAIL, internalSubject, internalHTML(d, itemId), 'HANDS Logistics'));

    await Promise.all(emailQueue);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true, itemId })
    };

  } catch (err) {
    console.error('submit-order error:', err.message);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};
