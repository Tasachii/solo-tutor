/**
 * Solo Tutor — สำรองข้อมูลลง Google Sheets ของครูเอง
 * วางไฟล์นี้ใน Apps Script ที่ผูกกับสเปรดชีต แล้ว Deploy เป็น Web App
 * อ่านขั้นตอนแบบภาพใน docs/google-sheets/README.md
 *
 * หมายเหตุความปลอดภัย: Apps Script อ่าน HTTP header ไม่ได้ (Google ประกาศว่าจะไม่รองรับ)
 * จึงตรวจสิทธิ์จาก token ในตัว body แทน — เก็บ token ไว้ใน Script Properties ไม่ใช่ในโค้ดนี้
 */

var BACKUP_SHEET = '_ข้อมูลสำรอง'

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return json({ ok: false, error: 'empty' })
    var payload = JSON.parse(e.postData.contents)
    if (payload.format !== 'solo-sheets-1') return json({ ok: false, error: 'format' })

    var expected = PropertiesService.getScriptProperties().getProperty('TOKEN')
    if (!expected || !safeEqual(String(payload.token || ''), expected)) return json({ ok: false, error: 'token' })

    // ล็อกไว้ กันสองเครื่องเขียนพร้อมกันแล้วตารางปนกัน
    var lock = LockService.getScriptLock()
    if (!lock.tryLock(20000)) return json({ ok: false, error: 'busy' })
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet()
      ;(payload.tables || []).forEach(function (t) { writeTable(ss, t.name, t.rows) })
      writeBackup(ss, payload.backup || [], payload.at, payload.mode)
      return json({ ok: true, at: payload.at, tables: (payload.tables || []).length })
    } finally {
      lock.releaseLock()
    }
  } catch (err) {
    return json({ ok: false, error: String(err) })
  }
}

/** เปิด URL ตรง ๆ ในเบราว์เซอร์ = เห็นว่าติดตั้งถูกแล้ว ไม่เผยข้อมูลอะไร */
function doGet() {
  return json({ ok: true, service: 'solo-sheets-1' })
}

function writeTable(ss, name, rows) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name)
  sheet.clear()
  if (!rows || !rows.length) return
  var width = rows.reduce(function (w, r) { return Math.max(w, r.length) }, 0)
  var padded = rows.map(function (r) {
    var out = r.slice()
    while (out.length < width) out.push('')
    return out
  })
  sheet.getRange(1, 1, padded.length, width).setValues(padded)
  sheet.getRange(1, 1, 1, width).setFontWeight('bold')
  sheet.setFrozenRows(1)
}

/** สำเนา JSON ทั้งก้อน แบ่งเป็นท่อนละแถว — ใช้กู้คืนแบบครบทุกตัวอักษร */
function writeBackup(ss, chunks, at, mode) {
  var sheet = ss.getSheetByName(BACKUP_SHEET) || ss.insertSheet(BACKUP_SHEET)
  sheet.clear()
  var rows = [['solo-sheets-1', at || '', mode || '']]
  chunks.forEach(function (c) { rows.push([c, '', '']) })
  sheet.getRange(1, 1, rows.length, 3).setValues(rows)
  sheet.hideSheet()
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false
  var diff = 0
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}
