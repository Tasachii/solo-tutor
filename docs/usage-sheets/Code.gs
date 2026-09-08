/** Solo Tutor usage mirror — bind this script to a dedicated private Sheet. */
var FORMAT = 'solo-usage-1'
var SHEET = 'usage_events'
var EVENTS = { app_open: true, students_changed: true, invoice_issued: true, payment_recorded: true }
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents || e.postData.contents.length > 20000) return reply(false, 'invalid')
    var payload = JSON.parse(e.postData.contents)
    var properties = PropertiesService.getScriptProperties()
    var expected = properties.getProperty('USAGE_WEBHOOK_SECRET')
    var sheetId = properties.getProperty('USAGE_SHEET_ID')
    if (!expected || !safeEqual(String(payload.secret || ''), expected)) return reply(false, 'unauthorized')
    if (!sheetId || !/^[A-Za-z0-9_-]{20,200}$/.test(sheetId)) return reply(false, 'configuration')
    if (payload.format !== FORMAT || !Array.isArray(payload.rows) || payload.rows.length < 1 || payload.rows.length > 50) {
      return reply(false, 'invalid')
    }
    var rows = payload.rows.map(validateRow)
    if (rows.some(function (row) { return !row })) return reply(false, 'invalid')

    var lock = LockService.getScriptLock()
    if (!lock.tryLock(10000)) return reply(false, 'busy')
    try {
      var cache = CacheService.getScriptCache()
      var spreadsheet = SpreadsheetApp.openById(sheetId)
      var sheet = spreadsheet.getSheetByName(SHEET) || spreadsheet.insertSheet(SHEET)
      if (sheet.getLastRow() === 0) sheet.appendRow(['random_id', 'event', 'count', 'at'])
      var accepted = []
      var fingerprints = []
      var pending = Object.create(null)
      rows.forEach(function (row) {
        var minute = row[3].slice(0, 16)
        var rateKey = 'rate:' + row[0] + ':' + minute
        var used = Number(cache.get(rateKey) || '0')
        if (used >= 120) return
        cache.put(rateKey, String(used + 1), 120)
        var fingerprint = digest(row.join('\u0000'))
        if (cache.get('seen:' + fingerprint) || pending[fingerprint]) return
        pending[fingerprint] = true
        accepted.push(row)
        fingerprints.push(fingerprint)
      })
      if (accepted.length) sheet.getRange(sheet.getLastRow() + 1, 1, accepted.length, 4).setValues(accepted)
      fingerprints.forEach(function (fingerprint) { cache.put('seen:' + fingerprint, '1', 21600) })
      return reply(true, '', accepted.length)
    } finally {
      lock.releaseLock()
    }
  } catch (_) {
    return reply(false, 'internal')
  }
}

/** Run once from the editor while this script is bound to its dedicated Sheet. */
function setupSheetId() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  if (!spreadsheet) throw new Error('Open this bound script from its Google Sheet before setup')
  var id = spreadsheet.getId()
  if (!id || !/^[A-Za-z0-9_-]{20,200}$/.test(id)) throw new Error('Invalid spreadsheet ID')
  PropertiesService.getScriptProperties().setProperty('USAGE_SHEET_ID', id)
  return id
}

function validateRow(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'at,count,event,random_id') return null
  var id = String(value.random_id || '').toLowerCase()
  var event = String(value.event || '')
  var count = value.count
  var at = String(value.at || '')
  if (!UUID.test(id) || !Object.prototype.hasOwnProperty.call(EVENTS, event)
    || typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 10000) return null
  var date = new Date(at)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at)
    || isNaN(date.getTime()) || date.toISOString() !== at) return null
  return [id, event, count, at]
}

function digest(value) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '')
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false
  var difference = 0
  for (var i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return difference === 0
}

function doGet() { return reply(true, '', 0) }

function reply(ok, error, accepted) {
  return ContentService.createTextOutput(JSON.stringify({ ok: ok, error: error || undefined, accepted: accepted || 0 }))
    .setMimeType(ContentService.MimeType.JSON)
}
