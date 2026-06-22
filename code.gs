/**************** CONFIG ****************/
// ============================================================
// ⚠️  ห้าม hardcode ค่าจริงในไฟล์นี้
//     ค่าทั้งหมดเก็บอยู่ใน Script Properties
//     ตั้งค่าครั้งแรกด้วยการรัน setupScriptProperties() ด้านล่าง
// ============================================================
const _props         = PropertiesService.getScriptProperties();
const SPREADSHEET_ID = _props.getProperty('SPREADSHEET_ID') || '';
const FOLDER_ID      = _props.getProperty('FOLDER_ID')      || '';
const TOKEN          = _props.getProperty('TOKEN')           || '';
const MANUAL_URL     = _props.getProperty('MANUAL_URL')      || '';

// ============================================================
//  รันฟังก์ชันนี้ครั้งเดียวเพื่อบันทึกค่าลง Script Properties
//  1. ใส่ค่าจริงด้านล่าง
//  2. กด ▶ Run เลือก setupScriptProperties
//  3. ลบค่าจริงออกจากฟังก์ชันนี้ทันที (เหลือแค่ placeholder)
// ============================================================
function setupScriptProperties() {
  PropertiesService.getScriptProperties().setProperties({
    'SPREADSHEET_ID': 'ใส่_SPREADSHEET_ID',
    'FOLDER_ID':      'ใส่_FOLDER_ID',
    'TOKEN':          'ใส่_CHANNEL_ACCESS_TOKEN',
    'MANUAL_URL':     'ใส่_URL_คู่มือ_หรือเว้นว่าง'
  });
  Logger.log('✅ บันทึก Script Properties เรียบร้อย');
  Logger.log('SPREADSHEET_ID = ' + PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'));
}


// [Design System] ธีมสี (ค่าเริ่มต้น)
const THEME_COLOR = "#2C3E50"; 
const BTN_PRIMARY = "#2C3E50";
const BTN_SECONDARY = "#95A5A6";
const COLOR_SUCCESS = "#27AE60";
const COLOR_DANGER = "#C0392B";
const COLOR_WARNING = "#F39C12";
const COLOR_ADJUST = "#8E44AD";

// [ฟังก์ชันตั้งค่าเริ่มต้นกรณีหน้าเว็บยังไม่เคยเซฟ]
function getDefaultSettings() {
  return {
    sysName: "คลังอะไหล่เมาท์เทน",
    themeColor: "#2C3E50",
    prefixItem: "IT",
    prefixTool: "TL",
    maintenance: false,
    welcomeMsg: "👋 ยินดีต้อนรับสู่ระบบคลังอะไหล่เมาท์เทน\n\n👇 ด้านล่างนี้คือคู่มือการใช้งานเบื้องต้นครับ\n\nเมื่อพร้อมแล้ว พิมพ์: ลงทะเบียน ชื่อ-นามสกุล เพื่อส่งคำขอใช้งานได้เลยครับ",
    manualUrl: "",
    autoApprove: false,
    maxBorrowDays: 7,
    reqRemark: false,
    decimalPlaces: 0,
    lineNotifyToken: "",
    dailyDigestTime: "08:30",
    sessionTimeout: 30,
    adminContact: "",
    rowsPerPage: 100,
    dateFormat: "TH",
    darkMode: false,
    sysLogo: "",
    lineOaId: ""  // LINE OA ID สำหรับ QR Fast Track เช่น @abc1234d
  };
}

function getSettings() {
  const props = PropertiesService.getScriptProperties();
  const s = props.getProperty('APP_SETTINGS');
  if (s) {
    return JSON.parse(s);
  }
  return getDefaultSettings();
}

/**************** ENTRY POINT (LINE BOT) ****************/
function doPost(e) {
  // API call จาก GitHub Pages (มี fn field)
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.fn) {
      return _jsonOut(_apiRun(body.fn, body.args || []));
    }
  } catch(err) {}

  // LINE Webhook
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return;
  }

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return;
    }

    const data = JSON.parse(e.postData.contents);
    const event = data.events[0];
    if (!event) {
      return;
    }
    
    const userId = event.source.userId;
    const replyToken = event.replyToken;

    // Cache เพื่อกันข้อความซ้ำ
    if (CacheService.getScriptCache().get(replyToken)) {
      return;
    }
    CacheService.getScriptCache().put(replyToken, "processed", 60);

    const settings = getSettings();

    // --- ส่งคู่มือเมื่อแอดไลน์ ---
    if (event.type === 'follow') {
      const welcomeText = settings.welcomeMsg || "👋 ยินดีต้อนรับสู่ระบบ\nพิมพ์: ลงทะเบียน ชื่อ-นามสกุล เพื่อส่งคำขอใช้งานครับ";
      
      if (settings.manualUrl && settings.manualUrl !== "") {
        send(replyToken, [
          { type: "text", text: welcomeText },
          { type: "image", originalContentUrl: settings.manualUrl, previewImageUrl: settings.manualUrl }
        ]);
      } else {
        reply(replyToken, welcomeText);
      }
      return;
    }

    const user = getUser(userId);
    
    // ตรวจสอบโหมด Maintenance
    if (settings.maintenance && user && user.role !== 'admin') {
       return reply(replyToken, "🚧 ระบบกำลังปิดปรับปรุง/นับสต็อกชั่วคราว กรุณาติดต่อ Admin ครับ");
    }

    if (event.type === 'postback') {
      return handlePostback(event.postback.data, userId, replyToken);
    }

    if (event.type === 'message') {
      // 1. จัดการรูปภาพ
      if (event.message.type === 'image') {
        const step = cacheGet(userId, "newItemStep");
        if (step === "5") {
          return handleNewItemProcess(userId, replyToken, null, event.message.id);
        }
        
        saveImage(event.message.id, userId);
        
        const pendingItem = cacheGet(userId, "item");
        const pendingQty = cacheGet(userId, "qty");
        const pendingMode = cacheGet(userId, "mode");
        const returnReqId = cacheGet(userId, "return_req_id");

        if (returnReqId) {
             const borrowData = getBorrowRequestById(returnReqId);
             if (borrowData) {
                 return replyFlex(replyToken, flexConfirm({
                   mode: "คืน", 
                   machine: borrowData.category, 
                   itemName: borrowData.itemName, 
                   itemCode: borrowData.itemCode, 
                   qty: borrowData.qty
                 }, settings));
             }
        } else if (pendingItem && pendingQty) {
             const itemInfo = getItemInfo(pendingItem, getPreferredSheet(pendingMode));
             return replyFlex(replyToken, flexConfirm({
               mode: pendingMode, 
               machine: itemInfo.category, 
               itemName: itemInfo.name, 
               itemCode: itemInfo.code, 
               qty: Number(pendingQty)
             }, settings));
        }
        return reply(replyToken, "📸 บันทึกรูปภาพเรียบร้อย!");
      }
      
      // 2. จัดการข้อความ Text
      if (event.message.type === 'text') {
        return handleText(event.message.text.trim(), userId, replyToken);
      }

      return reply(replyToken, "⚠️ ขออภัยครับ ระบบรองรับเฉพาะการพิมพ์ข้อความและส่งรูปภาพเท่านั้น\n\n(หากต้องการเริ่มใหม่ พิมพ์ 'เมนู')");
    }
  } catch (error) {
    console.error("Main Error: " + error.toString());
    try {
      const data = JSON.parse(e.postData.contents);
      const token = data.events[0].replyToken;
      // ป้องกันการส่งข้อความ error ซ้ำๆ
      if (!CacheService.getScriptCache().get(token + "_err")) {
         reply(token, "❌ เกิดข้อผิดพลาดทางเทคนิค กรุณาลองใหม่อีกครั้ง หรือติดต่อผู้ดูแลระบบ");
         CacheService.getScriptCache().put(token + "_err", "1", 60);
      }
    } catch (err) {
      // Ignore inner catch
    }
  } finally {
    lock.releaseLock();
  }
}
// 1. ฟังก์ชันสำหรับตรวจสอบรหัสผ่านรายบุคคล
function webVerifyUserPin(uid, pin) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = ss.getSheetByName("Users");
    if (!sh) return false;

    const data = sh.getDataRange().getValues();
    const headers = data[0];

    // หา column PIN จาก header ก่อน
    // layout: A=userId B=name C=role D=PIN E=dept F=Time
    let pinColIdx = headers.findIndex(h => String(h).trim().toUpperCase() === "PIN");
    if (pinColIdx === -1) pinColIdx = 3; // fallback col D (index 3)

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(uid).trim()) {
        let userPin = String(data[i][pinColIdx] || "").trim();
        // ถ้า PIN ว่าง ให้ default เป็น '1234'
        if (userPin === "") userPin = "1234";
        return userPin === String(pin).trim();
      }
    }
    return false;
  } catch(e) {
    console.error(e);
    return false;
  }
}

// 2. ฟังก์ชันสำหรับเปลี่ยนรหัสผ่านส่วนตัว
function webUpdateUserPin(uid, newPin) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Users");
    if (!sheet) return {success: false, error: "ไม่พบชีต Users"};
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    let pinColIdx = headers.indexOf("PIN");
    
    // ถ้ายังไม่มีคอลัมน์ PIN ให้สร้างใหม่
    if (pinColIdx === -1) {
      pinColIdx = headers.length;
      sheet.getRange(1, pinColIdx + 1).setValue("PIN");
    }
    
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(uid)) {
        sheet.getRange(i + 1, pinColIdx + 1).setValue(String(newPin).trim());
        return {success: true};
      }
    }
    return {success: false, error: "ไม่พบผู้ใช้งานนี้ในระบบ"};
  } catch(e) {
    return {success: false, error: String(e)};
  }
}

// 3b. ดึงรายชื่อ users เฉพาะสำหรับหน้า Login (เร็วกว่า getInventoryData มาก)
function getLoginUsers() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = ss.getSheetByName('Users');
    if (!sh || sh.getLastRow() < 2) return [];
    return sh.getDataRange().getValues().slice(1)
      .filter(r => {
        const role = String(r[2] || '').trim().toLowerCase();
        return (role === 'admin' || role === 'user') && String(r[0] || '').trim() !== '';
      })
      .map(r => ({
        userId: String(r[0] || '').trim(),
        name:   String(r[1] || '').trim(),
        role:   String(r[2] || '').trim()
      }));
  } catch(e) {
    return [];
  }
}
// ลงทะเบียนผู้ใช้ใหม่ (จากหน้าทำรายการ QR)
// ⚠️ เขียนลง sheet "QRRegistrations" แยกต่างหาก — ไม่แตะ Users sheet เลย
// เมื่อ Admin อนุมัติผ่าน LINE ค่อยย้ายมา Users พร้อม PIN ที่ถูกต้อง
function webRegisterUser(payload) {
  try {
    if (!payload || !payload.name || !payload.pin || payload.pin.length < 4) {
      return { success: false, error: "ข้อมูลไม่ครบถ้วน" };
    }

    // ตั้งค่าเวลาเป็นไทย (GMT+7)
    const now = new Date();
    const tzOffset = 7 * 60 * 60 * 1000;
    const localTime = new Date(now.getTime() + tzOffset);

    // สร้าง ID ชั่วคราวสำหรับ QR registration
    const newUserId = "U" + Date.now() + Math.random().toString(36).substring(2, 9);

    // ---- เขียนลง QRRegistrations sheet (แยกจาก Users) ----
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let qrSh = ss.getSheetByName("QRRegistrations");
    if (!qrSh) {
      // สร้าง sheet ใหม่ถ้ายังไม่มี
      qrSh = ss.insertSheet("QRRegistrations");
      qrSh.appendRow(["userId", "name", "dept", "PIN", "registeredAt", "status"]);
      qrSh.setFrozenRows(1);
    }

    // ตรวจชื่อซ้ำใน QRRegistrations (กันกดสมัครซ้ำ)
    const qrRows = qrSh.getDataRange().getValues().slice(1);
    const dupQR = qrRows.find(r => String(r[1] || '').trim() === payload.name.trim() && String(r[5] || '').trim() === 'pending');
    if (dupQR) return { success: false, error: `ชื่อ "${payload.name}" ยังรอการอนุมัติอยู่` };

    // ตรวจชื่อซ้ำใน Users (กันสมัครทับคนที่อนุมัติแล้ว)
    const usersRows = sheet("Users").getDataRange().getValues().slice(1);
    const dupUser = usersRows.find(r => String(r[1] || '').trim() === payload.name.trim());
    if (dupUser) return { success: false, error: `ชื่อ "${payload.name}" มีในระบบแล้ว` };

    // บันทึกลง QRRegistrations: [userId, name, dept, PIN, registeredAt, status]
    qrSh.appendRow([
      newUserId,
      payload.name,
      payload.dept || "",
      payload.pin,   // PIN เก็บแค่ใน QRRegistrations ไม่ไปยุ่งกับ Users
      localTime,
      "pending"
    ]);

    // บันทึก audit
    _writeAudit("REGISTER", `สมัครใหม่: ${payload.name} (${payload.dept || "ไม่ระบุ"})`, payload.name, newUserId, "pending", "Web-Registration");

    return { success: true, message: `ส่งคำขอสมัครของ "${payload.name}" เรียบร้อย!` };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ── QR Registration Functions ──────────────────────────────

function webGetQRPending() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = ss.getSheetByName("QRRegistrations");
    if (!sh) return [];
    const rows = sh.getDataRange().getValues().slice(1);
    return rows
      .filter(r => String(r[5]).trim() === 'pending')
      .map(r => ({
        userId:       String(r[0]),
        name:         String(r[1]),
        dept:         String(r[2]),
        pin:          String(r[3]),
        registeredAt: r[4] ? Utilities.formatDate(new Date(r[4]), 'Asia/Bangkok', 'dd/MM/yyyy HH:mm') : '',
        status:       String(r[5])
      }));
  } catch(e) { return []; }
}

function webApproveQRUser(userId) {
  try {
    const ss  = SpreadsheetApp.openById(SPREADSHEET_ID);
    const qrSh = ss.getSheetByName("QRRegistrations");
    if (!qrSh) return { success: false, error: "ไม่พบ QRRegistrations sheet" };

    const qrData = qrSh.getDataRange().getValues();
    for (let i = 1; i < qrData.length; i++) {
      if (String(qrData[i][0]).trim() === String(userId).trim() && String(qrData[i][5]).trim() === 'pending') {
        const name = qrData[i][1];
        const dept = qrData[i][2];
        const pin  = qrData[i][3];
        const date = qrData[i][4];

        // ย้ายเข้า Users sheet
        const usersSh = ss.getSheetByName("Users");
        const numCols  = Math.max(usersSh.getLastColumn(), 8);
        const row      = new Array(numCols).fill('');
        row[0] = userId;
        row[1] = name;
        row[2] = 'qr';  // QR user เข้าได้แค่หน้า qr.html
        row[3] = pin;   // col D = PIN
        row[4] = dept;  // col E = dept
        row[5] = date;  // col F = Time
        row[7] = 'QR-Registration';
        usersSh.appendRow(row);

        // อัปเดต status ใน QRRegistrations
        qrSh.getRange(i + 1, 6).setValue('approved');

        _writeAudit("REGISTER", "อนุมัติจาก QR: " + name, "Admin", userId, "user", "Web-Approve");
        return { success: true };
      }
    }
    return { success: false, error: "ไม่พบคำขอนี้" };
  } catch(e) { return { success: false, error: e.toString() }; }
}

function webRejectQRUser(userId) {
  try {
    const ss   = SpreadsheetApp.openById(SPREADSHEET_ID);
    const qrSh = ss.getSheetByName("QRRegistrations");
    if (!qrSh) return { success: false, error: "ไม่พบ QRRegistrations sheet" };

    const qrData = qrSh.getDataRange().getValues();
    for (let i = 1; i < qrData.length; i++) {
      if (String(qrData[i][0]).trim() === String(userId).trim() && String(qrData[i][5]).trim() === 'pending') {
        qrSh.getRange(i + 1, 6).setValue('rejected');
        _writeAudit("REGISTER", "ปฏิเสธจาก QR: " + qrData[i][1], "Admin", userId, "rejected", "Web-Reject");
        return { success: true };
      }
    }
    return { success: false, error: "ไม่พบคำขอนี้" };
  } catch(e) { return { success: false, error: e.toString() }; }
}

/* ============================================================
   WEB API — รับ request จาก GitHub Pages
   GET  ?fn=functionName&args=[...]
   POST { fn: "functionName", args: [...] }
============================================================ */
const _API_ALLOWED = [
  'getInventoryData','webVerifyUserPin','webUpdateUserPin',
  'webTransaction','webAddBorrow','webReturnItem',
  'webAdjustStock','webAddNewItems','webEditItem',
  'webSaveSettings','webGetNotes','webSaveNote','webDeleteNote',
  'webGetAuditLogs','webWriteAudit','webClearAuditLog','webClearLogs',
  'webGetQRPending','webApproveQRUser','webRejectQRUser',
  'webAddPendingPO','webUpdatePendingPO','webCancelPO','webReceivePO',
  'webGetBackupData','webUpdateUser','webFactoryReset'
];

function _apiRun(fn, args) {
  if (!_API_ALLOWED.includes(fn)) return { success:false, error:'not allowed' };
  try {
    const result = eval(fn).apply(null, args || []);
    return result !== undefined ? result : { success:true };
  } catch(e) { return { success:false, error:e.toString() }; }
}

function _jsonOut(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  // API call จาก GitHub Pages
  if (e.parameter.fn) {
    const args = e.parameter.args ? JSON.parse(e.parameter.args) : [];
    return _jsonOut(_apiRun(e.parameter.fn, args));
  }

  const settings = getSettings();
  if (e.parameter.page === 'scanner') {
    return HtmlService.createTemplateFromFile('Scanner')
      .evaluate()
      .setTitle('สแกน QR Code - ' + (settings.sysName || 'คลังอะไหล่'))
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
  }
  return HtmlService.createTemplateFromFile('C-Factory_Dashboard_Pro')
    .evaluate()
    .setTitle(settings.sysName || 'คลังอะไหล่เมาท์เทน')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// [ฟังก์ชันดึงข้อมูลสำหรับหน้าเว็บ]

/* ============================================================
   NOTES SYSTEM — เก็บใน Google Sheet แทน localStorage
============================================================ */
function webGetNotes(userId) {
  try {
    const sh = sheet('Notes');
    const data = sh.getDataRange().getValues();
    const notes = [];

    // ข้ามแถวแรกถ้าเป็น header
    const startRow = (String(data[0][0]).trim() === 'noteId') ? 1 : 0;

    for (let i = startRow; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;
      const rowUserId = String(row[1]).trim();
      // แสดงโน้ตของ user นั้น หรือถ้า userId ว่าง (ข้อมูลเก่า) ก็แสดงด้วย
      if (rowUserId === String(userId) || rowUserId === '') {
        notes.push({
          id:        String(row[0]),
          userId:    String(row[1]),
          userName:  String(row[2]),
          title:     String(row[3]),
          body:      String(row[4]),
          color:     String(row[5]) || '#fbbf24',
          createdAt: row[6] ? new Date(row[6]).getTime() : Date.now(),
          updatedAt: row[7] ? new Date(row[7]).getTime() : Date.now(),
        });
      }
    }
    notes.sort((a, b) => b.createdAt - a.createdAt);
    return { success: true, notes: notes };
  } catch(e) {
    return { success: false, error: e.toString() };
  }
}

function webSaveNote(payload) {
  try {
    const sh = sheet('Notes');

    // สร้าง header อัตโนมัติถ้ายังไม่มี
    const NOTES_HEADERS = ['noteId','userId','userName','title','body','color','createdAt','updatedAt'];
    if (sh.getLastRow() === 0) {
      sh.appendRow(NOTES_HEADERS);
    } else {
      const firstRow = sh.getRange(1, 1, 1, NOTES_HEADERS.length).getValues()[0];
      if (String(firstRow[0]).trim() !== 'noteId') {
        sh.insertRowBefore(1);
        sh.getRange(1, 1, 1, NOTES_HEADERS.length).setValues([NOTES_HEADERS]);
      }
    }

    const data = sh.getDataRange().getValues();
    const now = new Date();

    if (payload.id) {
      // แก้ไขโน้ตที่มีอยู่
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(payload.id)) {
          sh.getRange(i + 1, 4).setValue(payload.title || '');
          sh.getRange(i + 1, 5).setValue(payload.body || '');
          sh.getRange(i + 1, 6).setValue(payload.color || '#fbbf24');
          sh.getRange(i + 1, 8).setValue(now);
          return { success: true };
        }
      }
      return { success: false, error: 'ไม่พบโน้ตนี้' };
    } else {
      // สร้างโน้ตใหม่
      const noteId = 'N' + Date.now();
      sh.appendRow([
        noteId,
        payload.userId   || '',
        payload.userName || '',
        payload.title    || '',
        payload.body     || '',
        payload.color    || '#fbbf24',
        now,
        now
      ]);
      return { success: true, id: noteId };
    }
  } catch(e) {
    return { success: false, error: e.toString() };
  }
}

function webDeleteNote(noteId, userId) {
  try {
    const sh = sheet('Notes');
    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(noteId) && String(data[i][1]) === String(userId)) {
        sh.deleteRow(i + 1);
        return { success: true };
      }
    }
    return { success: false, error: 'ไม่พบโน้ตนี้' };
  } catch(e) {
    return { success: false, error: e.toString() };
  }
}

function getInventoryData() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    
    const getData = (sheetName) => {
      const s = ss.getSheetByName(sheetName);
      if (s && s.getLastRow() > 1) {
        return s.getDataRange().getValues().slice(1);
      }
      return [];
    };

    // ⚠️ ดึงข้อมูลพร้อมบังคับลบช่องว่าง (Trim) เพื่อแก้ปัญหาการกรองหมวดหมู่หน้าเว็บ
    const itemsData = getData("Items");
    // หา index ของ location column จาก header row (รองรับทั้ง sheet ที่มีและไม่มี location column)
    const itemsHeader = (() => {
      const s = ss.getSheetByName("Items");
      return s && s.getLastRow() > 0 ? s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0] : [];
    })();
    const itemsLocCol = itemsHeader.findIndex(h => String(h).toLowerCase().trim() === 'location');

    const items = itemsData.map(r => {
      return {
        code: String(r[0] || "").trim(), 
        name: String(r[1] || "").trim(), 
        category: String(r[2] || "").trim(), 
        unit: String(r[3] || "").trim(), 
        min: Number(r[4] || 0), 
        stock: Number(r[5] || 0),
        location: itemsLocCol >= 0 ? String(r[itemsLocCol] || "").trim() : "",
        date: String(r[7] || "").trim(),
        remark: String(r[8] || "").trim()
      };
    });

    const toolsData = getData("Tools");
    const toolsHeader = (() => {
      const s = ss.getSheetByName("Tools");
      return s && s.getLastRow() > 0 ? s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0] : [];
    })();
    const toolsLocCol = toolsHeader.findIndex(h => String(h).toLowerCase().trim() === 'location');

    const tools = toolsData.map(r => {
      return {
        code: String(r[0] || "").trim(), 
        name: String(r[1] || "").trim(), 
        category: String(r[2] || "").trim(), 
        unit: String(r[3] || "").trim(), 
        min: Number(r[4] || 0), 
        stock: Number(r[5] || 0),
        location: toolsLocCol >= 0 ? String(r[toolsLocCol] || "").trim() : "",
        date: String(r[7] || "").trim(),
        remark: String(r[8] || "").trim()
      };
    });

    const unitMap = {};
    items.forEach(i => { unitMap[i.code] = i.unit; });
    tools.forEach(t => { unitMap[t.code] = t.unit; });

    const logSheet = ss.getSheetByName("Logs");
    let history = [];
    if (logSheet && logSheet.getLastRow() > 1) {
      const limit = 500; // จำนวนประวัติย้อนหลังที่จะโหลดไปหน้าเว็บ
      const startRow = Math.max(2, logSheet.getLastRow() - limit + 1);
      const numRows = logSheet.getLastRow() - startRow + 1;
      
      // ดึง 9 คอลัมน์ (เผื่อมี Remark) เพื่อความสมบูรณ์
      const logData = logSheet.getRange(startRow, 1, numRows, Math.max(8, logSheet.getLastColumn())).getValues();
      history = logData.reverse().map(r => {
        return {
          time: formatDate(r[0]), 
          code: String(r[1] || "").trim(), 
          itemName: String(r[2] || "").trim(), 
          amount: String(r[3] || "").trim(), 
          balance: String(r[4] || "").trim(), 
          action: String(r[6] || "").trim(), 
          user: r[7] ? String(r[7]).trim() : "ไม่ระบุ", 
          remark: r[8] ? String(r[8]).trim() : "",
          unit: unitMap[String(r[1] || "").trim()] || "" 
        };
      });
    }

    const borrowRows = getData("BorrowRequests");
    const activeBorrows = borrowRows.filter(r => String(r[9]).trim() === 'approved').map(r => {
      return {
        reqId: String(r[0] || "").trim(), 
        date: formatDate(r[1]), 
        borrower: String(r[3] || "").trim(), 
        itemCode: String(r[4] || "").trim(), 
        itemName: String(r[5] || "").trim(), 
        qty: Number(r[6] || 0), 
        machine: r[7] ? String(r[7]).trim() : "-", 
        remark: r[11] ? String(r[11]).trim() : "ยืมผ่านหน้างาน" 
      };
    });

    const pendingPORows = getData("PendingPO");
    const pendingPOs = pendingPORows.map(r => {
      return {
        poCode: String(r[0] || "").trim(), 
        date: formatDate(r[1]), 
        supplier: String(r[2] || "").trim(), 
        itemCode: String(r[3] || "").trim(), 
        itemName: String(r[4] || "").trim(), 
        qty: Number(r[5] || 0), 
        status: String(r[6] || "").trim(), 
        remark: r[7] ? String(r[7]).trim() : "", 
        fileUrl: r[8] ? String(r[8]).trim() : ""
      };
    });

    const usersData = getData("Users");
    const users = usersData.map(r => {
      return {
        userId: String(r[0] || "").trim(), 
        name: String(r[1] || "").trim(), 
        role: String(r[2] || "").trim()
      };
    });

    const settings = getSettings();

    const finalData = { 
      items: items, 
      tools: tools, 
      history: history, 
      activeBorrows: activeBorrows, 
      pendingPOs: pendingPOs, 
      users: users,
      settings: settings
    };

    // ⚠️ บังคับแปลงข้อมูลทั้งหมดเป็น Plain Object เพื่อตัดปัญหาหน้าเว็บโหลดค้างจาก Date Format ของ Google Sheet
    return JSON.parse(JSON.stringify(finalData));

  } catch (e) {
    return { 
      error: e.toString(), 
      items: [], 
      tools: [], 
      history: [], 
      activeBorrows: [], 
      pendingPOs: [], 
      users: [],
      settings: getDefaultSettings()
    };
  }
}

// -------------------------------------------------------------------
// API สำหรับ Web Dashboard
// -------------------------------------------------------------------

function webSaveSettings(payload) {
  try {
    const current = getSettings();
    const updated = { ...current, ...payload };
    PropertiesService.getScriptProperties().setProperty('APP_SETTINGS', JSON.stringify(updated));
    _writeAudit("SETTINGS", `บันทึกการตั้งค่าระบบ`, payload.userName || "Admin", payload.userId || "-", "admin", "Web");
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function webVerifyPin(pin) {
  const currentPin = PropertiesService.getScriptProperties().getProperty('WEB_PIN') || '1234';
  if (String(pin) === currentPin || String(pin) === 'admin') {
    return true;
  }
  return false;
}

// webVerifyUserPin — ดูฟังก์ชันหลักด้านบน (บรรทัด ~194)



function webUpdatePin(newPin) {
  try { 
    PropertiesService.getScriptProperties().setProperty('WEB_PIN', String(newPin)); 
    return { success: true }; 
  } catch (e) { 
    return { success: false, error: e.toString() }; 
  }
}

function webAdjustStock(code, qty, userName, userId) {
  try {
    const displayUser = userName ? `${userName} (Web)` : "Web Dashboard";
    updateStock(code, qty, "ปรับยอด", displayUser);
    _writeAudit("ปรับยอด", `ปรับยอดสต็อก (Web): [${code}] ${qty > 0 ? "+" : ""}${qty}`, userName || "Web Dashboard", userId || "-", "-", "Web");
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function webAddPendingPO(poData) {
  try {
    // ✅ ตรวจสอบ items Array
    if (!poData.items || poData.items.length === 0) {
      return { success: false, error: "ไม่มีรายการสินค้า" };
    }
 
    let fileUrl = "";
    if (poData.pdfBase64) {
        const parentFolder = DriveApp.getFolderById(FOLDER_ID);
        const targetFolder = getSubFolder(parentFolder, "PO_Documents");
        const blob = Utilities.newBlob(
          Utilities.base64Decode(poData.pdfBase64), 
          'application/pdf', 
          poData.pdfName
        );
        const file = targetFolder.createFile(blob);
        try { 
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); 
        } catch(e) {}
        fileUrl = "https://drive.google.com/file/d/" + file.getId() + "/view";
    }
    
    let formattedDate = poData.date;
    try { 
      const dt = new Date(poData.date); 
      const d = String(dt.getDate()).padStart(2, '0');
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const y = String(dt.getFullYear() + 543).slice(-2);
      formattedDate = `${d}/${m}/${y}`; 
    } catch(e) {}
 
    // ✅ วนลูปบันทึกแต่ละรายการ
    poData.items.forEach(item => {
      sheet("PendingPO").appendRow([
        poData.poCode,
        formattedDate,
        poData.supplier,
        "-",
        item.itemName,          // ✅ ใช้ item.itemName
        Number(item.qty),       // ✅ ใช้ item.qty
        item.status,            // ✅ ใช้ item.status
        poData.remark || "",
        fileUrl
      ]);
    });
 
    return { success: true };
  } catch (e) { 
    return { success: false, error: e.toString() }; 
  }
}
function webReceivePO(poCode, userName, userId) {
  try {
    const sh = sheet("PendingPO");
    const data = sh.getDataRange().getValues();
    let updatedCount = 0;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(poCode).trim()) {
        sh.getRange(i + 1, 7).setValue("ได้รับแล้ว");
        updatedCount++;
      }
    }

    if (updatedCount === 0) {
      return { success: false, error: "ไม่พบรหัส PO นี้ในระบบ" };
    }
    _writeAudit("RECEIVE_PO", `รับ PO: ${poCode}`, userName || "Admin", userId || "-", "-", "Web");
    return { success: true };
  } catch(e) {
    return { success: false, error: e.toString() };
  }
}

// 1. webUpdatePendingPO()
function webUpdatePendingPO(poData) {
  try {
    if (!poData.poCode || !poData.items || poData.items.length === 0) {
      return { success: false, error: "ข้อมูล PO ไม่ครบถ้วน" };
    }

    const sh = sheet("PendingPO");
    const data = sh.getDataRange().getValues();
    
    // ค้นหาและลบรายการเก่า
    const rowsToDelete = [];
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]).trim() === String(poData.poCode).trim()) {
        rowsToDelete.push(i);
      }
    }
    
    for (const rowIdx of rowsToDelete) {
      sh.deleteRow(rowIdx + 1);
    }

    // จัดรูปแบบวันที่
    let formattedDate = poData.date;
    try { 
      const dt = new Date(poData.date); 
      const d = String(dt.getDate()).padStart(2, '0');
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const y = String(dt.getFullYear() + 543).slice(-2);
      formattedDate = `${d}/${m}/${y}`; 
    } catch(e) {}

    // บันทึกรายการสินค้าใหม่
    poData.items.forEach(item => {
      sheet("PendingPO").appendRow([
        poData.poCode,
        formattedDate,
        poData.supplier,
        "-",
        item.itemName,
        Number(item.qty),
        item.status,
        poData.remark || "",
        poData.fileUrl || ""
      ]);
    });

    return { success: true };
  } catch (e) { 
    return { success: false, error: e.toString() }; 
  }
}

// 2. webDeletePendingPO() [Optional]
function webDeletePendingPO(poCode) {
  try {
    const sh = sheet("PendingPO");
    const data = sh.getDataRange().getValues();
    
    let deletedCount = 0;
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]).trim() === String(poCode).trim()) {
        sh.deleteRow(i + 1);
        deletedCount++;
      }
    }
    
    if (deletedCount === 0) {
      return { success: false, error: "ไม่พบ PO ที่ต้องการลบ" };
    }
    
    return { success: true };
  } catch (e) { 
    return { success: false, error: e.toString() }; 
  }
}
function webCancelPO(poCode, reason, userName, userId) {
  try {
    const sh = sheet("PendingPO");
    const data = sh.getDataRange().getValues();
    let cancelledCount = 0;

    // เปลี่ยนสถานะเป็น "ยกเลิก" แทนการลบ (เพื่อเก็บประวัติไว้)
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(poCode).trim()) {
        sh.getRange(i + 1, 7).setValue("ยกเลิกแล้ว");
        // บันทึกสาเหตุลงช่อง remark (คอลัมน์ 8)
        const existingRemark = String(data[i][7] || "").trim();
        const newRemark = existingRemark
          ? `${existingRemark} | ยกเลิก: ${reason}`
          : `ยกเลิก: ${reason}`;
        sh.getRange(i + 1, 8).setValue(newRemark);
        cancelledCount++;
      }
    }

    if (cancelledCount === 0) {
      return { success: false, error: "ไม่พบ PO นี้ในระบบ" };
    }

    // บันทึกลง Logs
    const now = new Date();
    const tzOffset = 7 * 60 * 60 * 1000;
    const localTime = new Date(now.getTime() + tzOffset);
    const pad = n => String(n).padStart(2, "0");
    const d = localTime;
    const isEn = false; // ใช้ พ.ศ.
    const thaiYear = String(d.getUTCFullYear() + 543).slice(-2);
    const timeStr = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth()+1)}/${thaiYear} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

    sheet("Logs").appendRow([
      new Date(),
      poCode,
      `PO ${poCode}`,
      "-",
      "-",
      "WEB",
      "ยกเลิก PO",
      `${userName || "Admin"} — สาเหตุ: ${reason}`
    ]);

    _writeAudit("CANCEL_PO", `ยกเลิก PO: ${poCode} — สาเหตุ: ${reason}`, userName || "Admin", userId || "-", "-", "Web");

    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function webTransaction(payload) {
  try {
    // ตรวจสอบระบบซ่อมแซมเครื่องมือ
    if (payload.user && payload.user.includes("ซ่อมแซมแล้ว") && payload.mode === "รับเข้า") {
      payload.mode = "ซ่อมแซมแล้ว";
      const logSheet = sheet("Logs");
      const logsData = logSheet.getDataRange().getValues();
      let qtyToClear = Number(payload.qty);
      
      for (let i = logsData.length - 1; i > 0; i--) {
        if (qtyToClear <= 0) break;
        const logCode = String(logsData[i][1]).trim();
        const logAction = String(logsData[i][6]).trim();
        const logUser = String(logsData[i][7]).trim();
        
        if (logCode === String(payload.code).trim() && (logAction === "เบิก" || logAction === "แจ้งชำรุด") && logUser.includes("ชำรุด")) {
           const newUserStr = logUser.replace(/ชำรุด/g, "เคลียร์ซ่อมแล้ว");
           logSheet.getRange(i + 1, 8).setValue(newUserStr);
           const logQty = parseInt(String(logsData[i][3]).replace(/[^0-9]/g, '')) || 1;
           qtyToClear -= logQty;
        }
      }
    }
    
    const itemInfo = getItemInfo(payload.code);
    if (!itemInfo.code) return { success: false, error: "ไม่พบข้อมูลในระบบ" };
    if (Number(payload.qty) < 1) return { success: false, error: "จำนวนต้องเป็นจำนวนเต็มอย่างน้อย 1" };
    if ((payload.mode === "เบิก" || payload.mode === "แจ้งชำรุด") && itemInfo.stock < Number(payload.qty)) {
      return { success: false, error: `สต็อกไม่พอ! (มี: ${itemInfo.stock})` };
    }
    
    // ตั้งค่าเวลาเป็นเขตเวลาประเทศไทย (GMT+7) ป้องกันการขึ้น 07:00
    const now = new Date();
    const tzOffset = 7 * 60 * 60 * 1000; 
    const localTime = new Date(now.getTime() + tzOffset);

    // ทำการอัปเดตสต็อกจริง (ในนี้จะบันทึกประวัติลงชีต Logs 1 รอบตามปกติอยู่แล้ว)
    updateStock(payload.code, Number(payload.qty), payload.mode, payload.user || "Web User", payload.remark || "");

    const transId = (payload.mode === "รับเข้า" || payload.mode === "ซ่อมแซมแล้ว" ? "RC" : "WD") + Date.now();

    // บันทึกลงชีต Receives หรือ Requests เพื่อเป็นหลักฐานเท่านั้น
    if (payload.mode === "รับเข้า" || payload.mode === "ซ่อมแซมแล้ว") {
      sheet("Receives").appendRow([
        transId, localTime, "WEB", payload.user, payload.mode, payload.code, itemInfo.name, payload.qty, itemInfo.category, payload.remark || "Web Dashboard", "approved"
      ]);
    } else {
      sheet("Requests").appendRow([
        transId, localTime, "WEB", payload.user, payload.code, itemInfo.name, payload.qty, itemInfo.category, payload.remark || "Web Dashboard"
      ]);
    }
    
    return { success: true };
  } catch (e) { 
    return { success: false, error: e.toString() }; 
  }
}
function webAddNewItems(payloads) {
  try {
    if (!Array.isArray(payloads) || payloads.length === 0) return { success: false, error: "ข้อมูลไม่ครบถ้วน" };

    let successCount = 0;
    let errorCount = 0;
    let errors = [];

    // ตั้งค่าเวลาไทย GMT+7
    const now = new Date();
    const tzOffset = 7 * 60 * 60 * 1000;
    const localTime = new Date(now.getTime() + tzOffset);

    payloads.forEach((payload, index) => {
      try {
        if (!payload.code || !payload.name) throw new Error(`รายการที่ ${index + 1}: ข้อมูลไม่ครบ`);

        const sh = sheet(payload.type === "Tools" ? "Tools" : "Items");
        const existing = sh.getDataRange().getValues();

        for (let i = 1; i < existing.length; i++) {
          if (String(existing[i][0]).trim() === String(payload.code).trim()) {
            throw new Error(`รหัสซ้ำในระบบ (${payload.code})`);
          }
        }

        // 1. บันทึกข้อมูลลงชีตหลัก (Items หรือ Tools)
        sh.appendRow([
          payload.code, payload.name, payload.category, payload.unit, Number(payload.min) || 0, Number(payload.qty) || 0, payload.location || "", localTime, payload.remark || ""
        ]);

        // 2. บันทึกข้อมูลลงชีต Logs ช่องทางเดียวเท่านั้น โดยเปลี่ยนประเภทเป็น "New Item"
        // (หน้าเว็บจะรับค่านี้ไปแสดงผลอย่างถูกต้องสวยงามว่าเป็น "รับเข้า (ใหม่)")
        sheet("Logs").appendRow([
          localTime, payload.code, payload.name, "+" + payload.qty, payload.qty, "WEB", "New Item", payload.user, payload.remark || ""
        ]);

        _writeAudit("NEW_ITEM", `เพิ่มสินค้าใหม่: [${payload.code}] ${payload.name} จำนวน ${payload.qty} (${payload.type || "Items"})${payload.remark ? " | " + payload.remark : ""}`, payload.user || "Web", "-", "-", "Web");

        successCount++;
      } catch (e) {
        errorCount++;
        errors.push(e.toString());
      }
    });

    if (errorCount > 0) {
      return { success: false, error: `บันทึกสำเร็จ ${successCount} รายการ, ล้มเหลว ${errorCount} รายการ: ${errors.join("; ")}` };
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function webEditItem(payload) {
  try {
    const targetSheet = payload.type === "tool" ? "Tools" : "Items";
    const sh = sheet(targetSheet);
    const data = sh.getDataRange().getValues();
    const headers = data[0];

    // หา location column จาก header row (รองรับทั้ง sheet ที่มีและไม่มี location)
    let locationColIdx = headers.findIndex(h => String(h).toLowerCase().trim() === 'location');
    // ถ้าไม่เจอ header → ถ้า sheet มีคอลัมน์ >= 7 ก็ใช้คอลัมน์ G (index 6), ไม่งั้นเพิ่มคอลัมน์ใหม่
    if (locationColIdx < 0) {
      if (data[0].length >= 7) {
        locationColIdx = 6; // คอลัมน์ G
      } else {
        // เพิ่ม header location ที่คอลัมน์ถัดไป
        locationColIdx = data[0].length;
        sh.getRange(1, locationColIdx + 1).setValue("location");
      }
    }

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(payload.code).trim()) {
        sh.getRange(i + 1, 2).setValue(payload.name);
        sh.getRange(i + 1, 3).setValue(payload.category);
        sh.getRange(i + 1, 4).setValue(payload.unit);
        sh.getRange(i + 1, 5).setValue(payload.min);
        sh.getRange(i + 1, locationColIdx + 1).setValue(payload.location || "");
        _writeAudit("EDIT_ITEM", `แก้ไขข้อมูลสินค้า: [${payload.code}] ${payload.name} หมวด:${payload.category} หน่วย:${payload.unit} Min:${payload.min}`, payload.userName || "Web Admin", payload.userId || "-", payload.userRole || "-", "Web");
        return { success: true };
      }
    }
    return { success: false, error: "ไม่พบรหัสสินค้านี้ในระบบ" };
  } catch(e) {
    return { success: false, error: e.toString() };
  }
}

function webUpdateUser(payload) {
  try {
    updateUserRole(payload.userId, payload.role);
    
    let msgs = "";
    if (payload.role === 'user') {
      msgs = "✅ บัญชีของคุณได้รับการอนุมัติจาก Web Admin แล้ว!\nพิมพ์ 'เมนู' เพื่อเริ่มใช้งานได้เลยครับ";
    } else if (payload.role === 'rejected') {
      msgs = "❌ คำขอใช้งาน/บัญชีของคุณถูกระงับโดย Web Admin";
    } else if (payload.role === 'admin') {
      msgs = "👑 บัญชีของคุณได้รับการเลื่อนขั้นเป็น Admin เรียบร้อยแล้ว!";
    }

    if (msgs !== "") {
      push(payload.userId, [{ type: "text", text: msgs }]);
    }
    
    return { success: true };
  } catch (e) { 
    return { success: false, error: e.toString() }; 
  }
}

function webAddBorrow(payload) {
  try {
    const info = getItemInfo(payload.code);
    if (!info.code) {
      return { success: false, error: "ไม่พบข้อมูลสินค้า" };
    }
    if (!Number.isInteger(Number(payload.qty)) || Number(payload.qty) < 1) {
      return { success: false, error: "จำนวนต้องเป็นจำนวนเต็มอย่างน้อย 1" };
    }
    if (info.stock < Number(payload.qty)) {
      return { success: false, error: "สต็อกไม่พอ!" };
    }

    updateStock(payload.code, Number(payload.qty), "ยืม", payload.borrower);
    
    sheet("BorrowRequests").appendRow([
      "BW" + Date.now(), 
      new Date(payload.date || new Date()), 
      "WEB", 
      payload.borrower, 
      payload.code, 
      info.name, 
      payload.qty, 
      payload.machine || "-", 
      "Web Dashboard", 
      "approved", 
      new Date(), 
      payload.remark || "ยืมผ่านหน้าเว็บ"
    ]);

    _writeAudit("ยืม", `ยืมสินค้า (Web): [${payload.code}] ${info.name} จำนวน ${payload.qty}${payload.machine ? " | เครื่อง: " + payload.machine : ""}${payload.remark ? " | " + payload.remark : ""}`, payload.borrower, "-", "-", "Web");
    
    return { success: true };
  } catch (e) { 
    return { success: false, error: e.toString() }; 
  }
}

function webReturnItem(reqId, userName, userId) {
  try {
    const sh = sheet("BorrowRequests"); 
    const rows = sh.getDataRange().getValues();
    const idx = rows.findIndex(r => String(r[0]).trim() === String(reqId).trim());
    
    if (idx < 0) {
      return { success: false, error: "ไม่พบรายการยืมนี้ในระบบ" };
    }
    
    if (String(rows[idx][9]).trim() !== 'approved') {
       return { success: false, error: "รายการนี้ไม่ได้อยู่ในสถานะกำลังยืม" };
    }
    
    const itemCode = rows[idx][4];
    const qty = Number(rows[idx][6]);
    const borrowerName = rows[idx][3];
    const displayUser = userName ? `${userName} (Web)` : "Web Dashboard";
    
    // เปลี่ยนสถานะในชีต BorrowRequests เป็น returned (คืนแล้ว)
    sh.getRange(idx + 1, 10).setValue("returned"); 
    sh.getRange(idx + 1, 11).setValue(new Date());
    
    // คืนสต็อก
    updateStock(itemCode, qty, "คืน", `${displayUser} (${borrowerName})`);
    
    // บันทึกหลักฐานลง ReturnLogs
    const info = getItemInfo(itemCode);
    sheet("ReturnLogs").appendRow([
      "RT" + Date.now(), 
      new Date(), 
      "WEB", 
      userName || "Web Admin", 
      itemCode, 
      info.name, 
      qty, 
      "-",
      reqId
    ]);

    _writeAudit("คืน", `คืนสินค้า: [${itemCode}] ${info.name} จำนวน ${qty} | ผู้ยืม: ${borrowerName} | reqId: ${reqId}`, userName || "Web Admin", userId || "-", "-", "Web");
    
    return { success: true };
  } catch (e) { 
    return { success: false, error: e.toString() }; 
  }
}

function webGetBackupData() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let backupData = {};
    const sheets = ss.getSheets();
    
    for (let i = 0; i < sheets.length; i++) {
      const sh = sheets[i];
      backupData[sh.getName()] = sh.getDataRange().getDisplayValues();
    }
    
    return { success: true, data: JSON.stringify(backupData) };
  } catch(e) { 
    return { success: false, error: e.toString() }; 
  }
}

function webClearLogs(userName) {
  try {
    const logSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("Logs");
    if (logSheet && logSheet.getLastRow() > 1) {
      logSheet.getRange(2, 1, logSheet.getLastRow() - 1, logSheet.getLastColumn()).clearContent();
    }
    _writeAudit("SETTINGS", `ล้าง Logs ทั้งหมด`, userName || "Admin", "-", "admin", "Web");
    return { success: true };
  } catch (e) { 
    return { success: false, error: e.toString() }; 
  }
}

function webFactoryReset() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheetsToClear = ["Items", "Tools", "Withdraws", "Requests", "Receives", "BorrowRequests", "ReturnLogs", "AdjustLogs", "Logs", "PendingPO", "AuditLog"];
    
    sheetsToClear.forEach(shName => {
      const sh = ss.getSheetByName(shName);
      if (sh && sh.getLastRow() > 1) {
        sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
      }
    });
    
    // บันทึก AuditLog หลัง Factory Reset (เขียนลงตรงๆ เพราะชีตถูกล้างไปแล้ว)
    _writeAudit("FACTORY_RESET", "ล้างข้อมูลระบบทั้งหมด (Factory Reset)", "Admin", "-", "admin", "Web", "WARNING");
    
    return { success: true };
  } catch (e) { 
    return { success: false, error: e.toString() }; 
  }
}

/* ============================================================
   CENTRALIZED AUDIT LOG — เก็บใน Sheet "AuditLog"
   คอลัมน์: timestamp | type | user | userId | role | detail | device | status
============================================================ */
function _getOrCreateAuditSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName("AuditLog");
  if (!sh) {
    sh = ss.insertSheet("AuditLog");
    sh.appendRow(["timestamp", "type", "user", "userId", "role", "detail", "device", "status"]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 8).setBackground("#1e293b").setFontColor("#ffffff").setFontWeight("bold");
    sh.setColumnWidth(1, 160);
    sh.setColumnWidth(4, 200);
    sh.setColumnWidth(6, 350);
  }
  // บังคับ column A ทั้งหมดเป็น plain text เพื่อป้องกัน Sheet แปลง DD/MM/YY เป็น Date
  sh.getRange(1, 1, Math.max(sh.getMaxRows(), 1000), 1).setNumberFormat("@STRING@");
  return sh;
}

/* ============================================================
   _writeAudit() — ฟังก์ชันกลางสำหรับเขียน AuditLog จาก backend
   ใช้แทน webWriteAudit() ในส่วนที่เรียกจาก GAS โดยตรง
   (ไม่ต้องการ HTTP round-trip แบบที่ frontend ทำ)
============================================================ */
function _writeAudit(type, detail, user, userId, role, device, status) {
  try {
    const sh = _getOrCreateAuditSheet();

    const MAX_ROWS = 2000;
    const lastRow = sh.getLastRow();
    if (lastRow > MAX_ROWS) {
      sh.deleteRows(2, lastRow - MAX_ROWS);
    }

    const now = new Date();
    const tzOffset = 7 * 60 * 60 * 1000;
    const localTime = new Date(now.getTime() + tzOffset);
    const pad = n => String(n).padStart(2, "0");
    const d = localTime;
    const thaiYear = String(d.getUTCFullYear() + 543).slice(-2);
    const timeStr = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth()+1)}/${thaiYear} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

    const newRow = [
      timeStr,
      type   || "-",
      user   || "ไม่ระบุ",
      userId || "-",
      role   || "-",
      detail || "-",
      device || "LINE",
      status || "SUCCESS"
    ];

    const nextRow = sh.getLastRow() + 1;
    sh.getRange(nextRow, 1, 1, newRow.length).setValues([newRow])
      .setNumberFormat("@STRING@");
  } catch (e) {
    console.error("_writeAudit error: " + e);
  }
}

function webWriteAudit(payload) {
  try {
    if (!payload || !payload.type || !payload.detail) {
      return { success: false, error: "ข้อมูลไม่ครบ" };
    }

    const sh = _getOrCreateAuditSheet();

    // จำกัดสูงสุด 2000 แถว (ลบแถวเก่าสุดออกถ้าเกิน)
    const MAX_ROWS = 2000;
    const lastRow = sh.getLastRow();
    if (lastRow > MAX_ROWS) {
      const excessRows = lastRow - MAX_ROWS;
      sh.deleteRows(2, excessRows);
    }

    const now = new Date();
    const tzOffset = 7 * 60 * 60 * 1000;
    const localTime = new Date(now.getTime() + tzOffset);
    const pad = n => String(n).padStart(2, "0");
    const d = localTime;
    const thaiYear = String(d.getUTCFullYear() + 543).slice(-2);
    const timeStr = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth()+1)}/${thaiYear} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

    const newRow = [
      timeStr,
      payload.type   || "-",
      payload.user   || "ไม่ระบุ",
      payload.userId || "-",
      payload.role   || "-",
      payload.detail || "-",
      payload.device || "Web",
      payload.status || "SUCCESS"
    ];

    // ใช้ appendRow แล้วตั้ง NumberFormat เป็น @STRING@ เพื่อป้องกัน Sheet แปลง DD/MM/YY เป็น Date object
    const nextRow = sh.getLastRow() + 1;
    sh.getRange(nextRow, 1, 1, newRow.length).setValues([newRow])
      .setNumberFormat("@STRING@");

    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function webGetAuditLogs(limit) {
  try {
    const sh = _getOrCreateAuditSheet();
    const maxRows = limit || 500;
    const lastRow = sh.getLastRow();
    if (lastRow <= 1) return { success: true, logs: [] };

    const startRow = Math.max(2, lastRow - maxRows + 1);
    const numRows = lastRow - startRow + 1;
    const data = sh.getRange(startRow, 1, numRows, 8).getValues();

    const pad = n => String(n).padStart(2, "0");
    const formatCell = (v) => {
      // ถ้าเป็น Date object จาก Google Sheet ให้แปลงเป็น DD/MM/YY HH:MM:SS
      if (v instanceof Date && !isNaN(v.getTime())) {
        const tzOffset = 7 * 60 * 60 * 1000;
        const local = new Date(v.getTime() + tzOffset);
        const thaiYear = String(local.getUTCFullYear() + 543).slice(-2);
        return `${pad(local.getUTCDate())}/${pad(local.getUTCMonth()+1)}/${thaiYear} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
      }
      // ถ้าเป็น string อยู่แล้ว (บันทึกใหม่หลังแก้) ใช้ได้เลย
      return String(v || "");
    };

    const logs = data.reverse().map(r => ({
      time:   formatCell(r[0]),
      type:   String(r[1] || ""),
      user:   String(r[2] || ""),
      userId: String(r[3] || ""),
      role:   String(r[4] || ""),
      detail: String(r[5] || ""),
      device: String(r[6] || ""),
      status: String(r[7] || "SUCCESS")
    }));

    return { success: true, logs: logs };
  } catch (e) {
    return { success: false, error: e.toString(), logs: [] };
  }
}

function webClearAuditLog(userName) {
  try {
    const sh = _getOrCreateAuditSheet();
    if (sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, 8).clearContent();
    }
    const now = new Date();
    const tzOffset = 7 * 60 * 60 * 1000;
    const localTime = new Date(now.getTime() + tzOffset);
    const pad = n => String(n).padStart(2, "0");
    const d = localTime;
    const thaiYear = String(d.getUTCFullYear() + 543).slice(-2);
    const timeStr = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth()+1)}/${thaiYear} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    const nextRow = sh.getLastRow() + 1;
    sh.getRange(nextRow, 1, 1, 8).setValues([[timeStr, "SETTINGS", userName || "Admin", "-", "admin", "ล้าง Audit Log ทั้งหมด", "Web", "SUCCESS"]])
      .setNumberFormat("@STRING@");
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}



/**************** TEXT HANDLING ****************/
function handleText(text, userId, replyToken) {
  const user = getUser(userId);
  const settings = getSettings();

  if (text.startsWith("ลงทะเบียน")) {
    const name = text.replace("ลงทะเบียน", "").trim();
    if (!name) {
      return reply(replyToken, "⛔ กรุณาพิมพ์ชื่อหลังคำว่าลงทะเบียนด้วยครับ\nเช่น: ลงทะเบียน สมชาย ใจดี");
    }
    
    if (user) {
      if (user.role === 'pending') {
        return reply(replyToken, "⏳ คำขอของคุณกำลังรอการอนุมัติครับ");
      }
      if (user.role === 'rejected') {
        return reply(replyToken, "⛔ คำขอใช้งานถูกปฏิเสธครับ");
      }
      return reply(replyToken, "✅ คุณเป็นสมาชิกอยู่แล้วครับ พิมพ์ 'เมนู' เพื่อใช้งาน");
    }
    
    registerUser(userId, name);
    sendLineNotify(`🔔 มีพนักงานขอลงทะเบียนใหม่\nชื่อ: ${name}`, settings.lineNotifyToken);
    
    return send(replyToken, [
      { 
        type: "text", 
        text: "✅ ส่งคำขอลงทะเบียนเรียบร้อย!\n⏳ รอ Admin อนุมัติ..." 
      }, 
      flexMenu("pending", name, settings, userId)
    ]); 
  }

  if (!user) {
    return reply(replyToken, "⛔ กรุณาลงทะเบียนก่อนใช้งานครับ พิมพ์: ลงทะเบียน ชื่อ-นามสกุล");
  }
  
  if (user.role === 'pending') {
    return reply(replyToken, "⏳ บัญชีอยู่ระหว่างรออนุมัติครับ");
  }
  
  if (user.role === 'rejected') {
    return reply(replyToken, "⛔ บัญชีถูกระงับ");
  }

  if (text === "ยกเลิก" || text === "เมนู") {
    clearSession(userId);
    if (text === "ยกเลิก") {
      return reply(replyToken, "❌ ยกเลิกรายการแล้วครับ");
    }
    return replyFlex(replyToken, flexMenu(user.role, user.name, settings, userId));
  }

  if (text.startsWith("ประกาศ ")) {
    if (user.role !== 'admin') {
      return reply(replyToken, "⛔ เฉพาะ Admin ครับ");
    }
    const msg = text.replace("ประกาศ ", "").trim();
    if (msg) { 
      broadcastMessage(msg, user.name, settings); 
      return reply(replyToken, "📢 ส่งประกาศเรียบร้อย!"); 
    }
  }

  if (cacheGet(userId, "newItemStep")) {
    return handleNewItemProcess(userId, replyToken, text, null);
  }
  
  if (text === "เบิก") {
    return setMode(userId, "เบิก", replyToken);
  }
  
  if (text === "ยืม") {
    return setMode(userId, "ยืม", replyToken);
  }
  
  if (text === "คืน") { 
    clearSession(userId); 
    cacheSet(userId, "mode", "คืน"); 
    return sendActiveBorrows(userId, replyToken); 
  }
  
  if (text === "รับเข้า") {
    if (user.role === "admin") {
      return setMode(userId, "รับเข้า", replyToken);
    }
    return reply(replyToken, "⛔ เฉพาะ Admin ครับ");
  }
  
  if (text === "ปรับยอด") {
    if (user.role === "admin") {
      return setMode(userId, "ปรับยอด", replyToken);
    }
    return reply(replyToken, "⛔ เฉพาะ Admin ครับ");
  }

  if (text === "ประวัติ") {
    return replyFlex(replyToken, flexHistoryTypeSelection(settings));
  }
  
  if (text === "ประวัติสต็อก") {
    return sendHistory(replyToken, "Stock");
  }
  
  if (text === "ประวัติเครื่องมือ") {
    return sendHistory(replyToken, "Tools");
  }
  
  if (text === "ดูสต็อก") {
    return sendDashboardFlex(replyToken, userId, settings);
  }

  if (text.startsWith("ค้นหา")) {
    const kw = text.replace("ค้นหา", "").trim();
    if (kw) {
      return searchItem(kw, replyToken, settings);
    }
    return reply(replyToken, "🔍 พิมพ์: ค้นหา [ชื่อสินค้า]");
  }

  if (/^-?\d+(\.\d+)?$/.test(text)) { 
    const qty = Number(text);
    const mode = cacheGet(userId, "mode") || "เบิก";

    if (mode !== "ปรับยอด" && qty <= 0) {
      return reply(replyToken, "❌ จำนวนต้องมากกว่า 0 ครับ");
    }
    if (mode === "ปรับยอด" && qty === 0) {
      return reply(replyToken, "❌ จำนวนห้ามเป็น 0");
    }

    const rawItem = cacheGet(userId, "item");
    if (!rawItem) {
      return reply(replyToken, "❌ กรุณาเลือกสินค้าก่อนครับ");
    }
    
    const info = getItemInfo(rawItem, getPreferredSheet(mode));
    if (!info.code) {
      return reply(replyToken, "❌ ไม่พบข้อมูล: " + rawItem);
    }

    if (getSheetNameByMode(mode) !== info.sheet) {
      return reply(replyToken, `⛔ เลือกหมวดผิด กรุณาใช้เมนูให้ตรงกับประเภทของครับ`);
    }

    if ((mode === "เบิก" || mode === "ยืม" || mode === "แจ้งชำรุด") && qty > info.stock) {
      return reply(replyToken, `❌ ของไม่พอครับ (มี: ${info.stock})`);
    }

    cacheSet(userId, "qty", qty); 
    
    if (mode === "ปรับยอด") {
      return replyFlex(replyToken, flexConfirm({ 
        mode: mode, 
        machine: info.category, 
        itemName: info.name, 
        itemCode: info.code, 
        qty: qty 
      }, settings));
    }
    
    return reply(replyToken, `📸 ขั้นตอนสุดท้าย: ถ่ายรูปยืนยันการ${mode}\n(📦 ${info.name} จำนวน ${qty} ${info.unit})\nส่งรูปในแชทได้เลยครับ`);
  }

  // ── SCAN QR Fast Track ──
  // QR ฝัง URL: line://oaMessage/BOTID/?text=SCAN:BL-029
  // เมื่อพนักงานสแกน QR → LINE ส่งข้อความ "SCAN:BL-029" เข้ามา
  if (text.startsWith('SCAN:')) {
    const scanCode = text.replace('SCAN:', '').trim();
    const scanInfo = getItemInfo(scanCode) || getItemInfo(scanCode, 'Tools');
    if (!scanInfo || !scanInfo.code) {
      return reply(replyToken, `⚠️ ไม่พบรหัสสินค้า: ${scanCode}\nกรุณาตรวจสอบ QR Code ครับ`);
    }

    // เก็บ session ว่ากำลังจะเบิกอะไร
    clearSession(userId);
    cacheSet(userId, 'item', scanInfo.code);
    cacheSet(userId, 'mode', 'เบิก');
    cacheSet(userId, 'scan_fast', '1');

    const stockText = scanInfo.stock > 0
      ? `คงเหลือ ${scanInfo.stock} ${scanInfo.unit || 'ชิ้น'}`
      : '⚠️ สต็อกหมด';

    // ส่ง Flex พร้อม Quick Reply ปุ่มตัวเลข
    return replyFlex(replyToken, flexScanConfirm(scanInfo, settings));
  }

  // รับจำนวนจาก Quick Reply หลัง SCAN
  if (cacheGet(userId, 'scan_fast') === '1') {
    const scanQty = parseInt(text);
    if (!isNaN(scanQty) && scanQty > 0) {
      const scanCode = cacheGet(userId, 'item');
      const scanInfo = getItemInfo(scanCode) || getItemInfo(scanCode, 'Tools');
      if (scanInfo) {
        if (scanQty > scanInfo.stock) {
          return reply(replyToken, `⚠️ สต็อกมีแค่ ${scanInfo.stock} ${scanInfo.unit || 'ชิ้น'}\nกรุณาระบุจำนวนใหม่ครับ`);
        }
        // เบิกได้เลย ไม่ต้องถ่ายรูป
        updateStock(scanCode, -scanQty, 'เบิก', user.name);
        sheet('Logs').appendRow([new Date(), scanCode, scanInfo.name, `-${scanQty}`, scanInfo.stock - scanQty, 'LINE-QR', 'เบิก', user.name, 'QR Fast Track']);
        _writeAudit('เบิก', `[QR] [${scanCode}] ${scanInfo.name} จำนวน ${scanQty}`, user.name, userId, user.role, 'LINE-QR');
        clearSession(userId);

        return replyFlex(replyToken, flexScanSuccess({
          itemName: scanInfo.name,
          itemCode: scanCode,
          qty: scanQty,
          unit: scanInfo.unit || 'ชิ้น',
          remaining: scanInfo.stock - scanQty,
          userName: user.name
        }, settings));
      }
    }
    // กรอกเลขผิด
    return reply(replyToken, '⚠️ กรุณาระบุจำนวนเป็นตัวเลขครับ\nเช่น: 1, 2, 3');
  }

  // เพิ่มการรองรับรหัสสินค้าจากการสแกน QR (แบบเดิม)
  const scannedItemInfo = getItemInfo(text);
  if (scannedItemInfo && scannedItemInfo.code) {
    const currentMode = cacheGet(userId, 'mode') || 'เบิก';
    cacheSet(userId, 'item', scannedItemInfo.code);
    return reply(replyToken, `👉 ระบุจำนวนการ${currentMode}\n(📦 ${scannedItemInfo.name})\n[เหลือ: ${scannedItemInfo.stock} ${scannedItemInfo.unit}]`);
  }

  return reply(replyToken, "❓ ไม่เข้าใจคำสั่ง พิมพ์ 'เมนู' หรือ 'ค้นหา [ชื่อ]' ครับ");
}

/**************** POSTBACK HANDLING ****************/
function handlePostback(data, userId, replyToken) {
  const user = getUser(userId);
  const settings = getSettings();
  
  if (!user) {
    return reply(replyToken, "⛔ ลงทะเบียนก่อนครับ");
  }
  
  if (data === 'cancel') { 
    clearSession(userId); 
    return reply(replyToken, "❌ ยกเลิกแล้วครับ"); 
  }

  if (data.startsWith("approve:")) {
    const targetId = data.split(":")[1];

    // ---- ดึงข้อมูลจาก QRRegistrations ก่อน ----
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const qrSh = ss.getSheetByName("QRRegistrations");
    let approvedFromQR = false;

    if (qrSh) {
      const qrData = qrSh.getDataRange().getValues();
      for (let i = 1; i < qrData.length; i++) {
        if (String(qrData[i][0]).trim() === String(targetId).trim() && String(qrData[i][5]).trim() === 'pending') {
          const qrName  = qrData[i][1];
          const qrDept  = qrData[i][2];
          const qrPin   = qrData[i][3];
          const qrDate  = qrData[i][4];

          // ย้ายเข้า Users sheet พร้อม PIN ที่ถูกต้อง
          // layout: A=userId, B=name, C=role, D=แผนก, E=PIN, F=registeredAt, H=source
          const usersSh = sheet("Users");
          const numCols = Math.max(usersSh.getLastColumn(), 8);
          const newRow  = new Array(numCols).fill('');
          newRow[0] = targetId;
          newRow[1] = qrName;
          newRow[2] = 'user';
          newRow[3] = qrDept;
          newRow[4] = qrPin;   // PIN ถูกที่ column E เสมอ
          newRow[5] = qrDate;
          newRow[7] = 'QR-Registration';
          usersSh.appendRow(newRow);

          // อัปเดตสถานะใน QRRegistrations เป็น approved
          qrSh.getRange(i + 1, 6).setValue('approved');

          _writeAudit("REGISTER", `อนุมัติจาก QR: ${qrName} (${qrDept || 'ไม่ระบุ'})`, "Admin", targetId, "user", "LINE-Approve");
          approvedFromQR = true;
          break;
        }
      }
    }

    // ถ้าไม่เจอใน QRRegistrations ให้ fallback เปลี่ยน role ใน Users เหมือนเดิม (กรณีลงทะเบียนผ่าน LINE)
    if (!approvedFromQR) {
      updateUserRole(targetId, "user");
    }

    push(targetId, [{ type: "text", text: "✅ บัญชีอนุมัติแล้ว! พิมพ์ 'เมนู' ได้เลย" }]);
    return reply(replyToken, "✅ อนุมัติผู้ใช้เรียบร้อย");
  }
  
  if (data.startsWith("reject:")) {
    const targetId = data.split(":")[1];

    // ---- อัปเดตสถานะใน QRRegistrations ----
    const ss2 = SpreadsheetApp.openById(SPREADSHEET_ID);
    const qrSh2 = ss2.getSheetByName("QRRegistrations");
    let rejectedFromQR = false;

    if (qrSh2) {
      const qrData2 = qrSh2.getDataRange().getValues();
      for (let i = 1; i < qrData2.length; i++) {
        if (String(qrData2[i][0]).trim() === String(targetId).trim() && String(qrData2[i][5]).trim() === 'pending') {
          qrSh2.getRange(i + 1, 6).setValue('rejected');
          rejectedFromQR = true;
          break;
        }
      }
    }

    // fallback: ถ้าเป็นการสมัครผ่าน LINE ให้เปลี่ยน role ใน Users เหมือนเดิม
    if (!rejectedFromQR) {
      updateUserRole(targetId, "rejected");
    }

    push(targetId, [{ type: "text", text: "❌ คำขอถูกปฏิเสธ" }]);
    return reply(replyToken, "❌ ปฏิเสธเรียบร้อย");
  }

  if (data.startsWith("machine:")) {
    const cat = data.split(":")[1];
    cacheSet(userId, "machine", cat);
    const flex = flexItems(cat, userId, settings);
    if (flex) {
      return replyFlex(replyToken, flex);
    }
    return reply(replyToken, "❌ ไม่พบสินค้า");
  }

  if (data.startsWith("item:")) {
    const parts = data.split(":");
    cacheSet(userId, "item", parts[1]);
    const info = getItemInfo(parts[1], parts[2]);
    const currentMode = cacheGet(userId, "mode") || "เบิก";
    return reply(replyToken, `👉 ระบุจำนวนการ${currentMode}\n(📦 ${info.name})\n[เหลือ: ${info.stock} ${info.unit}]`);
  }

  if (data.startsWith("confirm|")) {
    const p = data.split("|");
    const itemCode = p[1];
    const qty = Number(p[2]);
    const action = p[3];
    
    if (action === "เบิก") {
      return submitWithdraw(userId, replyToken, itemCode, qty, settings);
    }
    if (action === "รับเข้า") {
      return submitReceive(userId, replyToken, itemCode, qty, settings);
    }
    if (action === "ยืม") {
      return submitBorrow(userId, replyToken, itemCode, qty, settings);
    }
    if (action === "คืน") {
      return submitReturn(userId, replyToken, itemCode, qty, settings);
    }
    if (action === "ปรับยอด") {
      return submitAdjust(userId, replyToken, itemCode, qty, settings);
    }
  }

  if (data.startsWith("borrow_approve:")) {
    return approveBorrowRequest(data.split(":")[1], userId, replyToken);
  }
  
  if (data.startsWith("borrow_reject:")) {
    return rejectBorrowRequest(data.split(":")[1], userId, replyToken);
  }
  
  if (data.startsWith("return_select:")) {
    const reqId = data.split(":")[1];
    const borrowData = getBorrowRequestById(reqId);
    
    if (!borrowData) {
      return reply(replyToken, "❌ ไม่พบรายการ");
    }
    
    cacheSet(userId, "return_req_id", reqId); 
    cacheSet(userId, "item", borrowData.itemCode); 
    cacheSet(userId, "qty", borrowData.qty); 
    cacheSet(userId, "mode", "คืน");
    
    return reply(replyToken, `📸 ถ่ายรูปยืนยันการคืน\n(🛠️ ${borrowData.itemName} จำนวน ${borrowData.qty})`);
  }

  if (data === "new_item_start") {
    if (user.role !== 'admin') {
      return reply(replyToken, "⛔ เฉพาะ Admin");
    }
    clearSession(userId); 
    return replyFlex(replyToken, flexTypeSelectionForNewItem(settings));
  }
  
  if (data.startsWith("new_item_type:")) {
    const type = data.split(":")[1];
    cacheSet(userId, "newItemType", type); 
    return replyFlex(replyToken, flexCategoryForNewItem(type, settings));
  }
  
  if (data.startsWith("new_item_cat:")) {
    const cat = data.split(":")[1];
    const type = cacheGet(userId, "newItemType") || "Items";
    const code = getNextItemCode(cat, type, settings);
    
    cacheSet(userId, "newItemData", JSON.stringify({ category: cat, code: code })); 
    cacheSet(userId, "newItemStep", "1");
    
    return reply(replyToken, `✨ เพิ่มของหมวด: ${cat}\n🔖 รหัส: ${code}\n\nStep 1/5: พิมพ์ **ชื่อสินค้า**:`);
  }
  
  if (data === "new_item_confirm") {
    return submitNewItem(userId, replyToken, settings);
  }
}

/**************** HELPER FUNCTIONS ****************/
function getSheetNameByMode(mode) { 
  if (mode === "ยืม" || mode === "คืน") {
    return "Tools";
  }
  return "Items"; 
}

function getPreferredSheet(mode) { 
  if (mode === "ยืม" || mode === "คืน") {
    return "Tools";
  }
  if (mode === "เบิก" || mode === "รับเข้า" || mode === "แจ้งชำรุด" || mode === "ซ่อมแซมแล้ว") {
    return "Items";
  }
  return null; 
}

function formatDate(dateObj) {
  if (!dateObj) {
    return "-";
  }
  try {
    const d = new Date(dateObj);
    if (isNaN(d.getTime())) return String(dateObj); // กรณีที่ Sheet ส่งข้อมูลมาแปลกๆ ให้ return ค่าเดิม
    
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear() + 543).slice(-2);
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    
    return `${day}/${month}/${year} ${hours}:${mins}`;
  } catch(e) {
    return String(dateObj);
  }
}

function broadcastMessage(message, senderName, settings) {
  const allUsers = sheet("Users").getDataRange().getValues().slice(1);
  const activeUsers = allUsers.filter(r => r[2] === 'user' || r[2] === 'admin');
  const tColor = settings.themeColor || THEME_COLOR;
  
  const flex = { 
    type: "flex", 
    altText: "📢 ประกาศจาก Admin", 
    contents: { 
      type: "bubble", 
      header: { 
        type: "box", 
        layout: "vertical", 
        contents: [
          { 
            type: "text", 
            text: "📢 ประกาศจาก Admin", 
            weight: "bold", 
            color: "#FFFFFF" 
          }
        ], 
        backgroundColor: tColor, 
        paddingAll: "md" 
      }, 
      body: { 
        type: "box", 
        layout: "vertical", 
        contents: [
          { 
            type: "text", 
            text: message, 
            wrap: true 
          }, 
          { 
            type: "text", 
            text: "จาก: " + senderName, 
            size: "xs", 
            color: "#aaaaaa", 
            margin: "md" 
          }
        ] 
      } 
    } 
  };
  
  for (let i = 0; i < activeUsers.length; i++) {
    const u = activeUsers[i];
    try { 
      push(u[0], [flex]); 
    } catch(e) {
      // Ignore specific user error
    } 
  }
}

function sendLineNotify(message, token) {
  if (!token || token === "") return;
  try {
    UrlFetchApp.fetch("https://notify-api.line.me/api/notify", {
      method: "post",
      headers: { "Authorization": "Bearer " + token },
      payload: { "message": message }
    });
  } catch (e) {
    // Ignore notify error
  }
}

/**************** CORE LOGIC FUNCTIONS ****************/
function setMode(userId, mode, replyToken) { 
  clearSession(userId); 
  cacheSet(userId, "mode", mode); 
  const settings = getSettings();
  const flex = flexMachine(mode, settings);
  return replyFlex(replyToken, flex); 
}

function submitWithdraw(userId, replyToken, itemCode, qty, settings) {
  const imageUrl = cacheGet(userId, "image");
  if (!imageUrl) {
    return reply(replyToken, "⛔ กรุณาถ่ายรูปก่อนครับ");
  }
  
  try {
    const user = getUser(userId);
    updateStock(itemCode, qty, "เบิก", user.name);
    
    const info = getItemInfo(itemCode, "Items");
    const rowData = [
      "WD" + Date.now(), 
      new Date(), 
      userId, 
      user.name, 
      itemCode, 
      info.name, 
      qty, 
      info.category, 
      imageUrl
    ];
    
    sheet("Requests").appendRow(rowData); 
    sheet("Withdraws").appendRow(rowData);
    
    clearItemData(userId);
    
    const replyMessages = [
      { 
        type: "text", 
        text: `✅ บันทึกเบิกเรียบร้อย!\n📦 ${info.name}\nจำนวน: ${qty} ${info.unit}` 
      }, 
      flexMenu(user.role, user.name, settings, userId)
    ];
    
    send(replyToken, replyMessages);
  } catch (e) { 
    reply(replyToken, "❌ Error: " + e); 
  }
}

function submitReceive(userId, replyToken, itemCode, qty, settings) {
  const imageUrl = cacheGet(userId, "image");
  if (!imageUrl) {
    return reply(replyToken, "⛔ ถ่ายรูปก่อนครับ");
  }
  
  const user = getUser(userId);
  updateStock(itemCode, qty, "รับเข้า", user.name);
  
  const info = getItemInfo(itemCode, "Items");
  sheet("Receives").appendRow([
    "RC" + Date.now(), 
    new Date(), 
    userId, 
    user.name, 
    "รับเข้า", 
    itemCode, 
    info.name, 
    qty, 
    info.category, 
    imageUrl, 
    "approved"
  ]);
  
  clearItemData(userId);
  
  const replyMessages = [
    { 
      type: "text", 
      text: `✅ รับเข้าเรียบร้อย!\n📦 ${info.name}\nจำนวน: ${qty} ${info.unit}` 
    }, 
    flexMenu(user.role, user.name, settings, userId)
  ];
  
  send(replyToken, replyMessages);
}

function submitAdjust(userId, replyToken, itemCode, qty, settings) {
  const user = getUser(userId);
  const infoB = getItemInfo(itemCode); 
  
  updateStock(itemCode, qty, "ปรับยอด", user.name); 
  
  const infoA = getItemInfo(itemCode);
  sheet("AdjustLogs").appendRow([
    "AD" + Date.now(), 
    new Date(), 
    userId, 
    user.name, 
    itemCode, 
    infoB.name, 
    qty, 
    infoB.sheet
  ]);
  
  clearItemData(userId);
  
  const sign = qty > 0 ? "+" : "";
  const replyMessages = [
    { 
      type: "text", 
      text: `✅ ปรับยอดเรียบร้อย!\n📦 ${infoB.name}\nปรับ: ${sign}${qty}\nคงเหลือใหม่: ${infoA.stock}` 
    }, 
    flexMenu(user.role, user.name, settings, userId)
  ];
  
  send(replyToken, replyMessages);
}

function submitBorrow(userId, replyToken, itemCode, qty, settings) {
  const img = cacheGet(userId, "image"); 
  if (!img) {
    return reply(replyToken, "⛔ ถ่ายรูปก่อนครับ");
  }
  
  const reqId = "BR" + Date.now(); 
  const user = getUser(userId); 
  const info = getItemInfo(itemCode, "Tools");
  
  if (settings.autoApprove) {
     updateStock(itemCode, qty, "ยืม", user.name);
     
     sheet("BorrowRequests").appendRow([
       reqId, 
       new Date(), 
       userId, 
       user.name, 
       itemCode, 
       info.name, 
       qty, 
       info.category, 
       img, 
       "approved", 
       new Date(), 
       "ยืมอัตโนมัติ"
     ]);
     
     clearItemData(userId);
     
     send(replyToken, [
       { type: "text", text: `✅ ยืมสำเร็จ! (อนุมัติอัตโนมัติ)\n📦 ${info.name}` }, 
       flexMenu(user.role, user.name, settings, userId)
     ]);
     
     sendLineNotify(`✅ มีการยืมสินค้า (อนุมัติอัตโนมัติ)\nผู้ยืม: ${user.name}\nรายการ: ${info.name}\nจำนวน: ${qty}`, settings.lineNotifyToken);

  } else {
     sheet("BorrowRequests").appendRow([
       reqId, 
       new Date(), 
       userId, 
       user.name, 
       itemCode, 
       info.name, 
       qty, 
       info.category, 
       img, 
       "pending"
     ]);
     
     clearItemData(userId); 
     reply(replyToken, "⏳ ส่งคำขอยืม รออนุมัติครับ");
     
     sendLineNotify(`🔔 มีคำขอยืมสินค้าใหม่\nผู้ยืม: ${user.name}\nรายการ: ${info.name}\nจำนวน: ${qty}`, settings.lineNotifyToken);
     
     const tColor = settings.themeColor || THEME_COLOR;
     const flex = { 
       type: "flex", 
       altText: "คำขอยืม", 
       contents: { 
         type: "bubble", 
         header: { 
           type: "box", 
           layout: "vertical", 
           contents: [
             { 
               type: "text", 
               text: "🛠️ คำขอยืมเครื่องมือ", 
               weight: "bold", 
               color: "#FFFFFF" 
             }
           ], 
           backgroundColor: "#E67E22", 
           paddingAll: "md" 
         }, 
         hero: { 
           type: "image", 
           url: img, 
           size: "full", 
           aspectRatio: "20:13", 
           aspectMode: "cover" 
         }, 
         body: { 
           type: "box", 
           layout: "vertical", 
           contents: [
             { 
               type: "text", 
               text: `${user.name} ขอขอยืม ${info.name} (${qty} ${info.unit})` 
             }
           ] 
         }, 
         footer: { 
           type: "box", 
           layout: "horizontal", 
           spacing: "md", 
           contents: [
             { 
               type: "button", 
               action: { 
                 type: "postback", 
                 label: "❌ ปฏิเสธ", 
                 data: "borrow_reject:" + reqId,
                 displayText: "❌ ปฏิเสธการยืม"
               }, 
               style: "secondary", 
               color: COLOR_DANGER 
             }, 
             { 
               type: "button", 
               action: { 
                 type: "postback", 
                 label: "✅ อนุมัติ", 
                 data: "borrow_approve:" + reqId,
                 displayText: "✅ อนุมัติการยืม"
               }, 
               style: "primary", 
               color: COLOR_SUCCESS 
             }
           ]
         } 
       } 
     };
     
     const allUsers = sheet("Users").getDataRange().getValues().slice(1);
     const admins = allUsers.filter(r => r[2] === 'admin');
     
     for (let i = 0; i < admins.length; i++) {
       const a = admins[i];
       try { 
         push(a[0], [flex]); 
       } catch(e) {
         // Ignore push error
       } 
     }
  }
}

function approveBorrowRequest(reqId, adminId, replyToken) {
  const sh = sheet("BorrowRequests"); 
  const rows = sh.getDataRange().getValues();
  const idx = rows.findIndex(r => String(r[0]) === reqId);
  
  if (idx < 0) {
    return reply(replyToken, "❌ ไม่พบ");
  }
  if (rows[idx][9] !== 'pending') {
    return reply(replyToken, "⚠️ ไม่ได้รออนุมัติ");
  }
  
  try { 
    const itemCode = rows[idx][4];
    const qty = Number(rows[idx][6]);
    const borrowerName = getUser(rows[idx][2]).name;
    updateStock(itemCode, qty, "ยืม", borrowerName); 
  } catch(e) { 
    return reply(replyToken, "❌ ตัดสต็อกไม่สำเร็จ: " + e); 
  }
  
  sh.getRange(idx + 1, 10).setValue("approved"); 
  sh.getRange(idx + 1, 11).setValue(new Date());
  
  const pushMsg = [
    { 
      type: "text", 
      text: `✅ อนุมัติยืม ${rows[idx][5]} แล้ว` 
    }
  ];
  
  push(rows[idx][2], pushMsg); 
  return reply(replyToken, "✅ อนุมัติเรียบร้อย");
}

function rejectBorrowRequest(reqId, adminId, replyToken) {
  const sh = sheet("BorrowRequests"); 
  const rows = sh.getDataRange().getValues();
  const idx = rows.findIndex(r => String(r[0]) === reqId);
  
  if (idx < 0) {
    return reply(replyToken, "❌ ไม่พบ");
  }
  
  sh.getRange(idx + 1, 10).setValue("rejected"); 
  sh.getRange(idx + 1, 11).setValue(new Date());
  
  const pushMsg = [
    { 
      type: "text", 
      text: `❌ คำขอยืม ${rows[idx][5]} ถูกปฏิเสธ` 
    }
  ];
  
  push(rows[idx][2], pushMsg); 
  return reply(replyToken, "❌ ปฏิเสธเรียบร้อย");
}

function sendActiveBorrows(userId, token) {
  const reqData = sheet("BorrowRequests").getDataRange().getValues().slice(1);
  const myBorrows = reqData.filter(r => String(r[2]) === userId && r[9] === 'approved');
  
  if (myBorrows.length === 0) {
    return reply(token, "🎉 ไม่มีรายการค้าง");
  }
  
  const settings = getSettings();
  const tColor = settings.themeColor || THEME_COLOR;

  const bubbles = myBorrows.map(r => {
    return { 
      type: "bubble", 
      header: { 
        type: "box", 
        layout: "vertical", 
        contents: [
          { 
            type: "text", 
            text: "🛠️ รายการยืมค้าง", 
            weight: "bold", 
            color: "#FFFFFF" 
          }
        ], 
        backgroundColor: tColor 
      }, 
      body: { 
        type: "box", 
        layout: "vertical", 
        contents: [
          { 
            type: "text", 
            text: r[5], 
            weight: "bold" 
          }, 
          { 
            type: "text", 
            text: `จำนวน: ${r[6]}` 
          }
        ] 
      }, 
      footer: { 
        type: "box", 
        layout: "vertical", 
        contents: [
          { 
            type: "button", 
            action: { 
              type: "postback", 
              label: "↩️ คืน", 
              data: "return_select:" + r[0],
              displayText: "คืน: " + r[5]
            }, 
            style: "primary", 
            color: COLOR_SUCCESS 
          }
        ] 
      } 
    };
  });
  
  const flexObj = { 
    type: "flex", 
    altText: "คืนของ", 
    contents: { 
      type: "carousel", 
      contents: bubbles 
    } 
  };
  
  replyFlex(token, flexObj);
}

function submitReturn(userId, replyToken, itemCode, qty, settings) {
  const reqId = cacheGet(userId, "return_req_id"); 
  if (!reqId) {
    return reply(replyToken, "❌ หมดอายุ");
  }
  
  const img = cacheGet(userId, "image"); 
  if (!img) {
    return reply(replyToken, "⛔ ถ่ายรูปก่อน");
  }
  
  const sh = sheet("BorrowRequests"); 
  const rows = sh.getDataRange().getValues();
  const idx = rows.findIndex(r => String(r[0]) === reqId);
  
  if (idx < 0) {
    return reply(replyToken, "❌ ไม่พบ");
  }
  
  sh.getRange(idx + 1, 10).setValue("returned"); 
  sh.getRange(idx + 1, 11).setValue(new Date());
  
  const user = getUser(userId); 
  updateStock(itemCode, qty, "คืน", user.name);
  
  const info = getItemInfo(itemCode, "Tools");
  
  const logRow = [
    "RT" + Date.now(), 
    new Date(), 
    userId, 
    user.name, 
    itemCode, 
    info.name, 
    qty, 
    img, 
    reqId
  ];
  sheet("ReturnLogs").appendRow(logRow);

  _writeAudit("คืน", `คืนสินค้า (LINE): [${itemCode}] ${info.name} จำนวน ${qty} | reqId: ${reqId}`, user.name, userId, user.role, "LINE");
  
  clearItemData(userId); 
  CacheService.getScriptCache().remove(userId + "_return_req_id");
  
  const replyMessages = [
    { 
      type: "text", 
      text: `✅ คืนเรียบร้อย!\n📦 ${info.name}` 
    }, 
    flexMenu(user.role, user.name, settings, userId)
  ];
  
  send(replyToken, replyMessages);
}

function getBorrowRequestById(reqId) {
  const rows = sheet("BorrowRequests").getDataRange().getValues();
  const r = rows.find(row => String(row[0]) === reqId);
  
  if (r) {
    return { 
      reqId: r[0], 
      userId: r[2], 
      itemCode: r[4], 
      itemName: r[5], 
      qty: Number(r[6]), 
      category: r[7], 
      imageUrl: r[8], 
      status: r[9] 
    };
  }
  return null;
}

function searchItem(keyword, replyToken, settings) {
  const itemsData = sheet("Items").getDataRange().getValues().slice(1); 
  const toolsData = sheet("Tools").getDataRange().getValues().slice(1);
  
  const mappedItems = itemsData.map(r => ({...r, sheet: "Items"}));
  const mappedTools = toolsData.map(r => ({...r, sheet: "Tools"}));
  const all = mappedItems.concat(mappedTools);
  
  const results = all.filter(r => {
    const nameMatch = String(r[1]).toLowerCase().includes(keyword.toLowerCase());
    const codeMatch = String(r[0]).toLowerCase().includes(keyword.toLowerCase());
    return nameMatch || codeMatch;
  });
  
  if (results.length === 0) {
    return reply(replyToken, `🔍 ไม่พบ "${keyword}"`);
  }
  
  const tColor = settings.themeColor || THEME_COLOR;

  const bubbles = results.slice(0, 10).map(r => {
    return { 
      type: "bubble", 
      size: "micro", 
      body: { 
        type: "box", 
        layout: "vertical", 
        contents: [
          { 
            type: "text", 
            text: r[1], 
            weight: "bold", 
            size: "sm", 
            wrap: true 
          }, 
          { 
            type: "text", 
            text: r[0], 
            size: "xxs" 
          }, 
          { 
            type: "text", 
            text: "เหลือ: " + r[5], 
            color: r[5] > 0 ? COLOR_SUCCESS : COLOR_DANGER, 
            weight: "bold" 
          }
        ] 
      }, 
      footer: { 
        type: "box", 
        layout: "vertical", 
        contents: [
          { 
            type: "button", 
            action: { 
              type: "postback", 
              label: "เลือก", 
              data: `item:${r[0]}:${r.sheet}`,
              displayText: "เลือก: " + r[1]
            }, 
            style: "primary", 
            color: tColor 
          }
        ] 
      } 
    };
  });
  
  const flexObj = { 
    type: "flex", 
    altText: "ผลการค้นหา", 
    contents: { 
      type: "carousel", 
      contents: bubbles 
    } 
  };
  
  replyFlex(replyToken, flexObj);
}

/**************** FLEX UI GENERATORS ****************/
function flexMenu(role, name, settings, uid) {
  const isAdmin = (String(role).toLowerCase() === 'admin');
  const tColor = settings.themeColor || THEME_COLOR;
  const sysName = settings.sysName || "คลังอะไหล่เมาท์เทน";
  
  let webUrl = ScriptApp.getService().getUrl();
  let scanUrl = webUrl;
  let txUrl   = webUrl; // URL หน้าเบิก/ยืม (code.html)
  if (webUrl && uid) {
    const separator = webUrl.includes('?') ? '&' : '?';
    // เปลี่ยนให้ลิงก์สแกนชี้ไปที่หน้า Scanner โดยตรง
    scanUrl = webUrl + "?page=scanner&uid=" + uid;
    txUrl   = webUrl + "?page=transaction&uid=" + uid;
  }
  if (!scanUrl) scanUrl = "https://line.me/R/nv/qrcode"; // Fallback
  
  const buttons = [
    { 
      type: "button", 
      action: { 
        type: "uri", 
        label: "📲 ทำรายการ (เบิก/ยืม)", 
        uri: txUrl 
      }, 
      style: "primary", 
      color: tColor 
    },
    { 
      type: "button", 
      action: { 
        type: "message", 
        label: "📦 เบิกคลังอะไหล่ (LINE)", 
        text: "เบิก" 
      }, 
      style: "secondary", 
      color: tColor 
    },
    { 
      type: "button", 
      action: { 
        type: "message", 
        label: "🛠️ ยืมเครื่องมือ", 
        text: "ยืม" 
      }, 
      style: "primary", 
      color: "#E67E22" 
    },
    { 
      type: "button", 
      action: { 
        type: "message", 
        label: "↩️ คืนเครื่องมือ", 
        text: "คืน" 
      }, 
      style: "primary", 
      color: "#3498DB" 
    },
    { 
      type: "button", 
      action: { 
        type: "uri", 
        label: "📷 สแกน QR Code", 
        uri: scanUrl 
      }, 
      style: "secondary",
      color: COLOR_SUCCESS
    }
  ];
  
  if (isAdmin) {
    buttons.push({ 
      type: "button", 
      action: { 
        type: "message", 
        label: "📥 รับของเข้าสต็อก", 
        text: "รับเข้า" 
      }, 
      style: "secondary", 
      color: COLOR_SUCCESS 
    });
    buttons.push({ 
      type: "button", 
      action: { 
        type: "postback", 
        label: "✨ เพิ่มรายการใหม่", 
        data: "new_item_start",
        displayText: "✨ เพิ่มรายการใหม่"
      }, 
      style: "secondary", 
      color: "#8E44AD" 
    });
    buttons.push({ 
      type: "button", 
      action: { 
        type: "message", 
        label: "🔧 ปรับยอดสต็อก", 
        text: "ปรับยอด" 
      }, 
      style: "secondary", 
      color: COLOR_ADJUST 
    });
  }
  
  return { 
    type: "flex", 
    altText: "เมนูหลัก", 
    contents: { 
      type: "bubble", 
      header: { 
        type: "box", 
        layout: "vertical", 
        contents: [
          { 
            type: "text", 
            text: sysName, 
            weight: "bold", 
            size: "xl", 
            color: "#FFFFFF" 
          }, 
          { 
            type: "text", 
            text: `สวัสดีครับคุณ ${name} (${role})`, 
            size: "xs", 
            color: "#FFFFFFCC" 
          }
        ], 
        backgroundColor: tColor, 
        paddingAll: "lg" 
      }, 
      body: { 
        type: "box", 
        layout: "vertical", 
        spacing: "md", 
        contents: [
          ...buttons, 
          { 
            type: "separator", 
            margin: "lg" 
          }, 
          { 
            type: "button", 
            action: { 
              type: "message", 
              label: "📊 ดูสต็อกคงเหลือ", 
              text: "ดูสต็อก" 
            }, 
            style: "link", 
            color: "#555555", 
            height: "sm" 
          }, 
          { 
            type: "button", 
            action: { 
              type: "message", 
              label: "📜 ดูประวัติ", 
              text: "ประวัติ" 
            }, 
            style: "link", 
            color: "#555555", 
            height: "sm" 
          }, 
          { 
            type: "text", 
            text: "พิมพ์ 'ค้นหา [ชื่อสินค้า]' เพื่อหาของ", 
            size: "xxs", 
            color: "#AAAAAA", 
            align: "center", 
            margin: "md" 
          }
        ], 
        paddingAll: "lg" 
      } 
    } 
  };
}

function flexHistoryTypeSelection(settings) {
  const tColor = settings.themeColor || THEME_COLOR;
  return { 
    type: "flex", 
    altText: "ประวัติ", 
    contents: { 
      type: "bubble", 
      body: { 
        type: "box", 
        layout: "vertical", 
        spacing: "md", 
        contents: [
          { 
            type: "text", 
            text: "📜 เลือกประเภทประวัติ", 
            weight: "bold", 
            size: "lg" 
          }, 
          { 
            type: "button", 
            action: { 
              type: "message", 
              label: "📦 ประวัติการเบิก/รับเข้า", 
              text: "ประวัติสต็อก" 
            }, 
            style: "primary", 
            color: tColor 
          }, 
          { 
            type: "button", 
            action: { 
              type: "message", 
              label: "🛠️ ประวัติการยืม/คืน", 
              text: "ประวัติเครื่องมือ" 
            }, 
            style: "secondary" 
          }
        ] 
      } 
    } 
  };
}

function flexTypeSelectionForNewItem(settings) {
  const tColor = settings.themeColor || THEME_COLOR;
  return { 
    type: "flex", 
    altText: "เลือกประเภทสินค้าใหม่", 
    contents: { 
      type: "bubble", 
      body: { 
        type: "box", 
        layout: "vertical", 
        spacing: "md", 
        contents: [
          { 
            type: "text", 
            text: "✨ เพิ่มรายการใหม่", 
            weight: "bold", 
            size: "lg" 
          }, 
          { 
            type: "button", 
            action: { 
              type: "postback", 
              label: "📦 คลังอะไหล่", 
              data: "new_item_type:Items",
              displayText: "เพิ่ม: คลังอะไหล่"
            }, 
            style: "primary", 
            color: tColor 
          }, 
          { 
            type: "button", 
            action: { 
              type: "postback", 
              label: "🛠️ เครื่องมือ", 
              data: "new_item_type:Tools",
              displayText: "เพิ่ม: เครื่องมือ"
            }, 
            style: "secondary" 
          }
        ] 
      } 
    } 
  };
}

function flexMachine(mode, settings) {
  const targetSheet = getSheetNameByMode(mode); 
  const tc = (mode === "ยืม" || mode === "คืน") ? "#E67E22" : (settings.themeColor || THEME_COLOR);
  const rows = sheet(targetSheet).getDataRange().getValues().slice(1);
  const machines = [...new Set(rows.filter(r => r[2]).map(r => normalizeText(r[2])))];
  
  if (machines.length === 0) {
    return { 
      type: "flex", 
      altText: "เลือกหมวด", 
      contents: { 
        type: "bubble", 
        body: { 
          type: "box", 
          layout: "vertical", 
          contents: [
            { 
              type: "text", 
              text: "❌ ไม่พบหมวดหมู่" 
            }
          ] 
        } 
      } 
    };
  }
  
  const bubbles = [];
  for (let i = 0; i < machines.length && i < 100; i += 10) {
    const chunk = machines.slice(i, i + 10);
    const buttons = chunk.map((l, idx) => {
      let shortLabel = String(i + idx + 1) + ". " + String(l);
      if (shortLabel.length > 20) {
        shortLabel = shortLabel.substring(0, 18) + "..";
      }
      return { 
        type: "button", 
        action: { 
          type: "postback", 
          label: shortLabel, 
          data: "machine:" + l,
          displayText: "เลือกหมวด: " + l
        }, 
        style: "secondary", 
        height: "sm", 
        margin: "sm" 
      };
    });
    
    bubbles.push({ 
      type: "bubble", 
      header: { 
        type: "box", 
        layout: "vertical", 
        contents: [
          { 
            type: "text", 
            text: `เลือกหมวดหมู่ (${Math.floor(i/10)+1})`, 
            weight: "bold", 
            color: "#FFFFFF" 
          }
        ], 
        backgroundColor: tc 
      }, 
      body: { 
        type: "box", 
        layout: "vertical", 
        contents: buttons 
      } 
    });
  }
  
  return { 
    type: "flex", 
    altText: "เลือกหมวด", 
    contents: { 
      type: "carousel", 
      contents: bubbles 
    } 
  };
}

function flexItems(category, userId, settings) {
  const mode = cacheGet(userId, "mode") || "เบิก"; 
  const ts = getSheetNameByMode(mode);
  const tColor = settings.themeColor || THEME_COLOR;
  
  let bMap = {};
  if (ts === "Tools") {
    const borrowRows = sheet("BorrowRequests").getDataRange().getValues().slice(1);
    borrowRows.filter(r => r[8] === 'approved').forEach(r => { 
      if(!bMap[r[4]]) {
        bMap[r[4]] = []; 
      }
      bMap[r[4]].push(r[3]); 
    });
  }
  
  const allDataRows = sheet(ts).getDataRange().getValues().slice(1);
  const items = allDataRows.filter(r => r[0] && normalizeText(r[2]) === normalizeText(category)).map(r => {
    return { 
      name: r[1], 
      code: r[0], 
      stock: Number(r[5] || 0), 
      unit: r[3] || "หน่วย" 
    };
  });
  
  if (items.length === 0) {
    return null;
  }
  
  const bubbles = [];
  for (let i = 0; i < items.length && i < 120; i += 10) {
    const chunk = items.slice(i, i + 10);
    const rows = chunk.map((l, idx) => {
      let boxContent = { 
        type: "box", 
        layout: "horizontal", 
        contents: [
          { 
            type: "text", 
            text: `${i + idx + 1}. ${l.name}`, 
            size: "sm", 
            flex: 7 
          }, 
          { 
            type: "text", 
            text: String(l.stock), 
            color: l.stock > 0 ? COLOR_SUCCESS : COLOR_DANGER, 
            flex: 2, 
            align: "end", 
            weight: "bold" 
          }
        ], 
        action: { 
          type: "postback", 
          data: `item:${l.code}:${ts}`,
          displayText: "เลือก: " + l.name
        }, 
        backgroundColor: "#F8F9F9", 
        cornerRadius: "md", 
        paddingAll: "md", 
        margin: "sm" 
      };
      
      if (bMap[l.code]) {
        return { 
          type: "box", 
          layout: "vertical", 
          contents: [
            boxContent, 
            { 
              type: "text", 
              text: "👤 ยืมโดย: " + bMap[l.code].join(", "), 
              size: "xxs", 
              color: COLOR_DANGER, 
              margin: "xs" 
            }
          ] 
        };
      }
      return boxContent;
    });
    
    bubbles.push({ 
      type: "bubble", 
      header: { 
        type: "box", 
        layout: "vertical", 
        contents: [
          { 
            type: "text", 
            text: category, 
            weight: "bold", 
            color: "#FFFFFF" 
          }
        ], 
        backgroundColor: tColor 
      }, 
      body: { 
        type: "box", 
        layout: "vertical", 
        contents: rows 
      } 
    });
  }
  
  return { 
    type: "flex", 
    altText: "รายการสินค้า", 
    contents: { 
      type: "carousel", 
      contents: bubbles 
    } 
  };
}

function flexConfirm(data, settings) {
  let themeColor = settings.themeColor || THEME_COLOR;
  
  if (data.mode === "รับเข้า") {
    themeColor = COLOR_SUCCESS;
  } else if (data.mode === "ยืม") {
    themeColor = "#E67E22";
  } else if (data.mode === "คืน") {
    themeColor = "#3498DB";
  } else if (data.mode === "ปรับยอด") {
    themeColor = COLOR_ADJUST;
  }

  return { 
    type: "flex", 
    altText: "ยืนยันรายการ", 
    contents: { 
      type: "bubble", 
      header: { 
        type: "box", 
        layout: "vertical", 
        contents: [
          { 
            type: "text", 
            text: `ยืนยันการ${data.mode}`, 
            weight: "bold", 
            color: "#FFFFFF" 
          }
        ], 
        backgroundColor: themeColor 
      }, 
      body: { 
        type: "box", 
        layout: "vertical", 
        contents: [
          { 
            type: "text", 
            text: "รายการ: " + data.itemName 
          }, 
          { 
            type: "text", 
            text: "จำนวน: " + data.qty, 
            size: "xl", 
            weight: "bold", 
            color: themeColor 
          }, 
          { 
            type: "box", 
            layout: "horizontal", 
            margin: "md", 
            spacing: "md", 
            contents: [
              { 
                type: "button", 
                action: { 
                  type: "postback", 
                  label: "❌ ยกเลิก", 
                  data: "cancel",
                  displayText: "❌ ยกเลิก"
                }, 
                style: "secondary" 
              }, 
              { 
                type: "button", 
                action: { 
                  type: "postback", 
                  label: "✅ ยืนยัน", 
                  data: `confirm|${data.itemCode}|${data.qty}|${data.mode}`,
                  displayText: "✅ ยืนยัน"
                }, 
                style: "primary", 
                color: themeColor 
              }
            ] 
          }
        ] 
      } 
    } 
  };
}

function flexConfirmNewItem(data) {
  return { 
    type: "flex", 
    altText: "ยืนยันรายการใหม่", 
    contents: { 
      type: "bubble", 
      header: { 
        type: "box", 
        layout: "vertical", 
        contents: [
          { 
            type: "text", 
            text: "✨ ยืนยันรายการใหม่", 
            weight: "bold", 
            color: "#FFFFFF" 
          }
        ], 
        backgroundColor: THEME_COLOR 
      }, 
      body: { 
        type: "box", 
        layout: "vertical", 
        contents: [
          lineItem("รหัส", data.code), 
          lineItem("ชื่อ", data.name), 
          lineItem("เริ่ม", data.qty + " " + data.unit, COLOR_SUCCESS, "bold")
        ] 
      }, 
      footer: { 
        type: "box", 
        layout: "horizontal", 
        spacing: "sm", 
        contents: [
          { 
            type: "button", 
            action: { 
              type: "message", 
              label: "❌ ยกเลิก", 
              text: "ยกเลิก" 
            }, 
            style: "secondary", 
            color: COLOR_DANGER 
          }, 
          { 
            type: "button", 
            action: { 
              type: "postback", 
              label: "✅ บันทึก", 
              data: "new_item_confirm",
              displayText: "✅ บันทึกรายการใหม่"
            }, 
            style: "primary", 
            color: BTN_PRIMARY 
          }
        ] 
      } 
    } 
  };
}

function flexCategoryForNewItem(targetSheetName, settings) {
  const rows = sheet(targetSheetName).getDataRange().getValues().slice(1);
  const machines = [...new Set(rows.filter(r => r[2]).map(r => r[2]))];
  const bubbles = [];
  
  for (let i = 0; i < machines.length && i < 100; i += 10) {
    const chunk = machines.slice(i, i + 10);
    const buttons = chunk.map((l, idx) => {
      let shortLabel = String(i + idx + 1) + ". " + String(l);
      if (shortLabel.length > 20) {
        shortLabel = shortLabel.substring(0, 18) + "..";
      }
      return { 
        type: "button", 
        action: { 
          type: "postback", 
          label: shortLabel, 
          data: "new_item_cat:" + l,
          displayText: "หมวด: " + l
        }, 
        style: "secondary", 
        margin: "sm" 
      };
    });
    
    bubbles.push({ 
      type: "bubble", 
      header: { 
        type: "box", 
        layout: "vertical", 
        contents: [
          { 
            type: "text", 
            text: `🆕 เลือกหมวด (${targetSheetName})`, 
            weight: "bold", 
            color: "#FFFFFF" 
          }
        ], 
        backgroundColor: "#8E44AD" 
      }, 
      body: { 
        type: "box", 
        layout: "vertical", 
        contents: buttons 
      } 
    });
  }
  
  return { 
    type: "flex", 
    altText: "เลือกหมวด", 
    contents: { 
      type: "carousel", 
      contents: bubbles 
    } 
  };
}

/**************** NEW ITEM WIZARD HANDLERS ****************/
function handleNewItemProcess(userId, replyToken, text, imageId) {
  const step = Number(cacheGet(userId, "newItemStep"));
  let data = JSON.parse(cacheGet(userId, "newItemData") || "{}");
  
  switch(step) {
    case 1: 
      data.name = text; 
      cacheSet(userId, "newItemData", JSON.stringify(data)); 
      cacheSet(userId, "newItemStep", "2"); 
      return reply(replyToken, "Step 2/5: พิมพ์หน่วยนับ:");
    case 2: 
      data.unit = text; 
      cacheSet(userId, "newItemData", JSON.stringify(data)); 
      cacheSet(userId, "newItemStep", "3"); 
      return reply(replyToken, "Step 3/5: พิมพ์ Min Stock (0 ถ้าไม่กำหนด):");
    case 3: 
      if (isNaN(text)) {
        return reply(replyToken, "❌ ตัวเลขเท่านั้น"); 
      }
      data.min = Number(text); 
      cacheSet(userId, "newItemData", JSON.stringify(data)); 
      cacheSet(userId, "newItemStep", "4"); 
      return reply(replyToken, "Step 4/5: ยอดเริ่มต้น:");
    case 4: 
      if (isNaN(text)) {
        return reply(replyToken, "❌ ตัวเลขเท่านั้น"); 
      }
      data.qty = Number(text); 
      cacheSet(userId, "newItemData", JSON.stringify(data)); 
      cacheSet(userId, "newItemStep", "5"); 
      return reply(replyToken, "Step 5/5: ถ่ายรูปสินค้า (หรือพิมพ์ 'ไม่มี' เพื่อข้าม):");
    case 5: 
      data.image = "-";
      if (imageId) {
        try {
           const url = `https://api-data.line.me/v2/bot/message/${imageId}/content`;
           const b = UrlFetchApp.fetch(url, { 
             headers: { Authorization: "Bearer " + TOKEN } 
           }).getBlob();
           
           const f = getSubFolder(DriveApp.getFolderById(FOLDER_ID), "Images_Receives").createFile(b);
           try { 
             f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); 
           } catch(e) {
             // Ignore sharing error
           }
           data.image = "https://drive.google.com/uc?export=view&id=" + f.getId();
        } catch(e) {
           // Ignore blob error
        }
      }
      cacheSet(userId, "newItemData", JSON.stringify(data)); 
      return replyFlex(replyToken, flexConfirmNewItem(data));
  }
}

function getNextItemCode(category, type, settings) {
  let defaultPrefix = type === "Tools" ? (settings.prefixTool || "TL") : (settings.prefixItem || "IT");
  
  const rows = sheet(type).getDataRange().getValues().slice(1);
  let prefix = defaultPrefix;

  // ตรวจสอบว่าหมวดหมู่มีการผูกตัวย่อไว้หรือไม่
  if (settings.categories && category) {
    let parts = settings.categories.split(',');
    for (let p of parts) {
      let str = p.trim();
      if (str.includes(':')) {
        let [c, pref] = str.split(':');
        if (c.trim() === category.trim() && pref.trim() !== '') {
          prefix = pref.trim().toUpperCase();
          break;
        }
      }
    }
  }

  // ค้นหาเลขถัดไปจากทั้งรายการอะไหล่และเครื่องมือ เพื่อป้องกันรหัสซ้ำ
  const allRows = sheet("Items").getDataRange().getValues().slice(1)
                  .concat(sheet("Tools").getDataRange().getValues().slice(1));
  
  let maxNum = 0;
  allRows.forEach(r => {
    if (r[0]) {
      let codeStr = String(r[0]);
      if (codeStr.startsWith(prefix)) {
        let numPart = "";
        if (codeStr.includes('-')) {
          let p = codeStr.split('-');
          if (p[0] === prefix) numPart = p[1];
        } else {
          numPart = codeStr.substring(prefix.length);
        }
        
        let num = parseInt(numPart, 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    }
  });

  return `${prefix}-${String(maxNum + 1).padStart(3, '0')}`;
}

function submitNewItem(userId, replyToken, settings) {
  const data = JSON.parse(cacheGet(userId, "newItemData")); 
  const type = cacheGet(userId, "newItemType") || "Items"; 
  
  if (!data || !data.code) {
    return reply(replyToken, "❌ ข้อมูลหมดอายุ กรุณาทำรายการใหม่");
  }
  
  const user = getUser(userId); 
  if (user.role !== 'admin') {
    return reply(replyToken, "⛔ เฉพาะ Admin");
  }
  
  sheet(type).appendRow([
    data.code, 
    data.name, 
    data.category, 
    data.unit, 
    data.min, 
    data.qty
  ]);
  
  sheet("Receives").appendRow([
    "NEW" + Date.now(), 
    new Date(), 
    "WEB", 
    user.name, 
    `รับเข้า (${type})`, 
    data.code, 
    data.name, 
    data.qty, 
    data.category, 
    data.image, 
    "approved"
  ]);
  
  sheet("Logs").appendRow([
    new Date(), 
    data.code, 
    data.name, 
    "+" + data.qty, 
    data.qty, 
    "LINE", 
    "New Item", 
    user.name
  ]);

  _writeAudit("NEW_ITEM", `เพิ่มสินค้าใหม่: [${data.code}] ${data.name} จำนวน ${data.qty} (${type})`, user.name, userId, user.role, "LINE");
  
  clearSession(userId); 
  
  send(replyToken, [
    { 
      type: "text", 
      text: `✅ เพิ่มรายการเรียบร้อย!\n📦 ${data.name}` 
    }, 
    flexMenu(user.role, user.name, settings, userId)
  ]);
}

/**************** HELPER & UTILS ****************/
function reply(token, text) { 
  send(token, [
    { 
      type: "text", 
      text: text 
    }
  ]); 
}

function replyFlex(token, flex) { 
  send(token, [flex]); 
}

function send(token, msgs) {
  const options = { 
    method: "post", 
    headers: { 
      "Authorization": "Bearer " + TOKEN, 
      "Content-Type": "application/json" 
    }, 
    payload: JSON.stringify({ 
      replyToken: token, 
      messages: msgs 
    }), 
    muteHttpExceptions: true 
  };
  
  const res = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/reply", options);
  
  if (res.getResponseCode() !== 200) {
    console.log(res.getContentText());
    try {
      UrlFetchApp.fetch("https://api.line.me/v2/bot/message/reply", {
        method: "post", 
        headers: { 
          "Authorization": "Bearer " + TOKEN, 
          "Content-Type": "application/json" 
        },
        payload: JSON.stringify({ 
          replyToken: token, 
          messages: [
            { 
              type: "text", 
              text: "❌ เกิดข้อผิดพลาดในการสร้างเมนู\nโปรดตรวจสอบข้อมูลอีกครั้ง" 
            }
          ] 
        })
      });
    } catch(e) {
      // Ignore error reporting error
    }
  }
}

function push(userId, msgs) {
  UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", { 
    method: "post", 
    headers: { 
      "Authorization": "Bearer " + TOKEN, 
      "Content-Type": "application/json" 
    }, 
    payload: JSON.stringify({ 
      to: userId, 
      messages: msgs 
    }), 
    muteHttpExceptions: true 
  });
}

function saveImage(id, uid) {
  try {
    const url = `https://api-data.line.me/v2/bot/message/${id}/content`;
    const b = UrlFetchApp.fetch(url, { 
      headers: { Authorization: "Bearer " + TOKEN } 
    }).getBlob();
    
    const modeStr = cacheGet(uid, "mode");
    const folderName = (modeStr === "รับเข้า" || modeStr === "ซ่อมแซมแล้ว") ? "Images_Receives" : "Images_Requests";
    const targetFolder = getSubFolder(DriveApp.getFolderById(FOLDER_ID), folderName);
    
    const f = targetFolder.createFile(b);
    try { 
      f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); 
    } catch(err) {
      // Ignore share error
    }
    cacheSet(uid, "image", "https://drive.google.com/uc?export=view&id=" + f.getId());
  } catch (e) {
    // Ignore fetch error
  }
}

function getSubFolder(parent, name) {
  const folders = parent.getFoldersByName(name); 
  if (folders.hasNext()) {
    return folders.next();
  }
  return parent.createFolder(name);
}

function sheet(n) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID); 
  let sh = ss.getSheetByName(n);
  
  if (!sh) {
    sh = ss.insertSheet(n);
    if(n === "Users") {
      sh.appendRow(["UserID", "Name", "Role"]);
    } else if (n === 'Items' || n === 'Tools') {
      sh.appendRow(['Code', 'Name', 'Category', 'Unit', 'Min', 'Stock']);
    } else if (n === 'Withdraws' || n === 'Requests') {
      sh.appendRow(['TransID', 'Date', 'UserID', 'Name', 'ItemCode', 'ItemName', 'Qty', 'Category', 'Image']);
    } else if (n === 'Receives') {
      sh.appendRow(['TransID', 'Date', 'UserID', 'UserName', 'Action', 'ItemCode', 'ItemName', 'Qty', 'Category', 'Image', 'Status']);
    } else if (n === 'BorrowRequests') {
      sh.appendRow(['ReqID', 'Date', 'UserID', 'Name', 'ItemCode', 'ItemName', 'Qty', 'Category', 'Image', 'Status', 'ActionDate', 'Remark']);
    } else if (n === 'ReturnLogs') {
      sh.appendRow(['ReturnID', 'Date', 'UserID', 'Name', 'ItemCode', 'ItemName', 'Qty', 'Image', 'RefReqID']);
    } else if (n === 'AdjustLogs') {
      sh.appendRow(['AdjID', 'Date', 'UserID', 'Name', 'ItemCode', 'ItemName', 'Qty', 'TargetSheet']);
    } else if (n === 'Logs') {
      sh.appendRow(['Date', 'ItemCode', 'ItemName', 'Change', 'Balance', 'Channel', 'Action', 'User', 'Remark']);
    } else if (n === 'PendingPO') {
      sh.appendRow(['POCode', 'Date', 'Supplier', 'ItemCode', 'ItemName', 'Qty', 'Status', 'Remark', 'FileUrl']);
    }
  }
  return sh;
}


/* ============================================================
   QR FAST TRACK — Flex Messages
   flexScanConfirm  : แสดงข้อมูลสินค้า + Quick Reply เลือกจำนวน
   flexScanSuccess  : ยืนยันเบิกสำเร็จ
============================================================ */
function flexScanConfirm(info, settings) {
  const themeColor = (settings && settings.themeColor) ? settings.themeColor : '#4f46e5';
  const stockColor = info.stock <= (info.min || 0) ? '#ef4444' : '#10b981';
  const stockLabel = info.stock <= (info.min || 0) ? '⚠️ ใกล้หมด' : '✅ พร้อมเบิก';

  return {
    type: 'flex',
    altText: `เบิก: ${info.name}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', paddingAll: '16px',
        backgroundColor: themeColor,
        contents: [
          { type: 'text', text: '📦 สแกน QR สำเร็จ', size: 'xs', color: '#ffffff', opacity: 0.7 },
          { type: 'text', text: info.name, size: 'md', weight: 'bold', color: '#ffffff', wrap: true, margin: 'xs' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'sm',
        contents: [
          {
            type: 'box', layout: 'horizontal', spacing: 'sm',
            contents: [
              { type: 'text', text: 'รหัส', size: 'sm', color: '#888888', flex: 2 },
              { type: 'text', text: info.code, size: 'sm', weight: 'bold', flex: 3 }
            ]
          },
          {
            type: 'box', layout: 'horizontal', spacing: 'sm',
            contents: [
              { type: 'text', text: 'คงเหลือ', size: 'sm', color: '#888888', flex: 2 },
              { type: 'text', text: `${info.stock} ${info.unit || 'ชิ้น'}`, size: 'sm', weight: 'bold', color: stockColor, flex: 3 }
            ]
          },
          {
            type: 'box', layout: 'horizontal', spacing: 'sm',
            contents: [
              { type: 'text', text: 'สถานะ', size: 'sm', color: '#888888', flex: 2 },
              { type: 'text', text: stockLabel, size: 'sm', flex: 3 }
            ]
          },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: 'เบิกกี่ชิ้น?', size: 'sm', color: '#555555', margin: 'md', weight: 'bold' }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
        contents: [
          {
            type: 'box', layout: 'horizontal', spacing: 'xs',
            contents: [1, 2, 3, 5, 10].map(n => ({
              type: 'button',
              action: { type: 'message', label: String(n), text: String(n) },
              style: n <= info.stock ? 'primary' : 'secondary',
              color: n <= info.stock ? themeColor : '#cccccc',
              height: 'sm', flex: 1
            }))
          },
          {
            type: 'button',
            action: { type: 'message', label: '✏️ กรอกจำนวนเอง', text: '' },
            style: 'secondary', height: 'sm', margin: 'xs',
            action: { type: 'message', label: '✏️ กรอกจำนวนเอง', text: 'กรอกเอง' }
          },
          {
            type: 'button',
            action: { type: 'message', label: '❌ ยกเลิก', text: 'ยกเลิก' },
            style: 'secondary', height: 'sm', color: '#ef4444'
          }
        ]
      }
    },
    quickReply: {
      items: [1, 2, 3, 5, 10].map(n => ({
        type: 'action',
        action: { type: 'message', label: `${n} ชิ้น`, text: String(n) }
      })).concat([{
        type: 'action',
        action: { type: 'message', label: 'ยกเลิก', text: 'ยกเลิก' }
      }])
    }
  };
}

function flexScanSuccess(data, settings) {
  const themeColor = (settings && settings.themeColor) ? settings.themeColor : '#4f46e5';
  const now = new Date();
  const timeStr = Utilities.formatDate(now, 'Asia/Bangkok', 'dd/MM/yyyy HH:mm');

  return {
    type: 'flex',
    altText: `✅ เบิกสำเร็จ: ${data.itemName} x${data.qty}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', paddingAll: '16px',
        backgroundColor: '#10b981',
        contents: [
          { type: 'text', text: '✅ เบิกสำเร็จ!', size: 'lg', weight: 'bold', color: '#ffffff' },
          { type: 'text', text: timeStr, size: 'xs', color: '#ffffff', opacity: 0.7, margin: 'xs' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'sm',
        contents: [
          {
            type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: 'สินค้า', size: 'sm', color: '#888888', flex: 2 },
              { type: 'text', text: data.itemName, size: 'sm', weight: 'bold', flex: 4, wrap: true }
            ]
          },
          {
            type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: 'รหัส', size: 'sm', color: '#888888', flex: 2 },
              { type: 'text', text: data.itemCode, size: 'sm', flex: 4 }
            ]
          },
          {
            type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: 'จำนวน', size: 'sm', color: '#888888', flex: 2 },
              { type: 'text', text: `${data.qty} ${data.unit}`, size: 'sm', weight: 'bold', color: '#10b981', flex: 4 }
            ]
          },
          {
            type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: 'คงเหลือ', size: 'sm', color: '#888888', flex: 2 },
              { type: 'text', text: `${data.remaining} ${data.unit}`, size: 'sm', color: data.remaining <= 5 ? '#ef4444' : '#374151', flex: 4 }
            ]
          },
          {
            type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ผู้เบิก', size: 'sm', color: '#888888', flex: 2 },
              { type: 'text', text: data.userName, size: 'sm', flex: 4 }
            ]
          }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px',
        contents: [{
          type: 'button',
          action: { type: 'message', label: '🏠 กลับเมนูหลัก', text: 'เมนู' },
          style: 'primary', color: themeColor, height: 'sm'
        }]
      }
    }
  };
}

/* ============================================================
   สร้าง QR URL สำหรับ print ออกมาติดชิ้นงาน
   เรียกจาก Web Dashboard เพื่อ generate QR URL
============================================================ */
function getQRFastTrackUrl(itemCode) {
  const settings = getSettings();
  const botId = settings.lineOaId || '';
  if (!botId) return itemCode; // fallback เป็น itemCode เดิม
  // URL ที่เมื่อสแกนแล้วจะเปิด LINE แล้วส่งข้อความ SCAN:itemCode เข้า Bot
  return `https://line.me/R/oaMessage/${botId}/?text=SCAN%3A${encodeURIComponent(itemCode)}`;
}

function getUser(id) { 
  const rows = sheet("Users").getDataRange().getValues().slice(1);
  const r = rows.find(row => String(row[0]).trim() === String(id).trim()); 
  if (r) {
    return { userId: r[0], name: r[1], role: r[2] };
  }
  return null; 
}

function registerUser(id, name) { 
  sheet("Users").appendRow([id, name, "pending"]); 
  _writeAudit("REGISTER", `ลงทะเบียนใหม่: ${name}`, name, id, "pending", "LINE");
  notifyAdmins(id, name); 
}

function notifyAdmins(uid, uname) {
  const flex = { 
    type: "flex", 
    altText: "คำขอใช้งาน", 
    contents: { 
      type: "bubble", 
      header: { 
        type: "box", 
        layout: "vertical", 
        contents: [
          { 
            type: "text", 
            text: "👤 คำขอใหม่", 
            color: "#FFFFFF" 
          }
        ], 
        backgroundColor: "#007bff" 
      }, 
      body: { 
        type: "box", 
        layout: "vertical", 
        contents: [
          { 
            type: "text", 
            text: uname 
          }
        ] 
      }, 
      footer: { 
        type: "box", 
        layout: "horizontal", 
        contents: [
          { 
            type: "button", 
            action: { 
              type: "postback", 
              label: "✅ อนุมัติ", 
              data: "approve:" + uid,
              displayText: "✅ อนุมัติผู้ใช้"
            }, 
            style: "primary" 
          }
        ] 
      } 
    } 
  };
  
  const allUsers = sheet("Users").getDataRange().getValues().slice(1);
  const admins = allUsers.filter(r => r[2] === 'admin');
  
  for (let i = 0; i < admins.length; i++) {
    const a = admins[i];
    try { 
      push(a[0], [flex]); 
    } catch(e) {
      // ignore
    } 
  }
}

function updateUserRole(id, role) { 
  const sh = sheet("Users"); 
  const data = sh.getDataRange().getValues(); 
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === id) { 
      sh.getRange(i + 1, 3).setValue(role);
      _writeAudit("USER_ROLE", `เปลี่ยน Role: ${data[i][1]} (${id}) → ${role}`, "Admin", id, "admin", "Web");
      break; 
    }
  }
}

function getItemInfo(q, prioritySheet) {
  const s = (sn) => { 
    const rows = sheet(sn).getDataRange().getValues().slice(1);
    let r = rows.find(row => String(row[0]).trim() === String(q).trim() || String(row[1]).trim() === String(q).trim()); 
    if (r) {
      return { 
        code: r[0], 
        name: r[1], 
        category: r[2], 
        unit: r[3], 
        min: Number(r[4] || 0), 
        stock: Number(r[5] || 0), 
        sheet: sn 
      };
    }
    return null; 
  };
  
  if (prioritySheet) { 
    const f = s(prioritySheet); 
    if (f) {
      return f; 
    }
  }
  
  const itemFound = s("Items");
  if (itemFound) return itemFound;
  
  const toolFound = s("Tools");
  if (toolFound) return toolFound;
  
  return { 
    code: null, 
    name: "Unknown", 
    category: "-", 
    stock: 0, 
    unit: "หน่วย", 
    min: 0 
  };
}

function updateStock(c, q, m, userName = "System", remark = "") {
  const info = getItemInfo(c); 
  if (!info.sheet) {
    throw "Not found";
  }
  
  const sh = sheet(info.sheet); 
  const rows = sh.getDataRange().getValues();
  
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(c).trim()) {
      let isMinus = (m === "เบิก" || m === "ยืม" || m === "แจ้งชำรุด");
      let ns = 0;
      
      if (m === "ปรับยอด") {
        ns = Number(rows[i][5]) + q;
      } else if (isMinus) {
        ns = Number(rows[i][5]) - q;
      } else {
        ns = Number(rows[i][5]) + q;
      }
      
      if (ns < 0) {
        throw "Stock ไม่พอ";
      }
      
      sh.getRange(i + 1, 6).setValue(ns);
      
      const checkMinCondition = (isMinus || (m === "ปรับยอด" && q < 0));
      if (checkMinCondition && ns <= Number(rows[i][4] || 0)) {
        notifyLowStock({ 
          name: rows[i][1], 
          stock: ns, 
          unit: rows[i][3] 
        });
      }
      
      const sign = (m === "ปรับยอด" ? (q > 0 ? "+" : "") : isMinus ? "-" : "+");
      const changeStr = sign + q;
      
      sheet("Logs").appendRow([
        new Date(), 
        c, 
        rows[i][1], 
        changeStr, 
        ns, 
        "LINE", 
        m, 
        userName,
        remark
      ]);

      // ✅ AuditLog — บันทึกทุก action ที่กระทบสต็อก
      _writeAudit(
        m,                                                    // type: เบิก / ยืม / คืน / รับเข้า / ปรับยอด
        `[${c}] ${rows[i][1]} ${changeStr} → คงเหลือ ${ns}${remark ? " | หมายเหตุ: " + remark : ""}`,
        userName,
        "-",
        "-",
        "LINE"
      );
      
      break;
    }
  }
}

function notifyLowStock(item) {
  const users = sheet("Users").getDataRange().getValues().slice(1);
  const admins = users.filter(r => r[2] === 'admin');
  
  for (let i = 0; i < admins.length; i++) {
    const a = admins[i];
    try { 
      push(a[0], [
        { 
          type: "text", 
          text: `⚠️ ของใกล้หมด!\n📦 ${item.name} เหลือ: ${item.stock}` 
        }
      ]); 
    } catch(e) {
      // Ignore push error
    } 
  }
}

function lineItem(l, v, c="#555555", w="regular") { 
  return { 
    type: "box", 
    layout: "baseline", 
    contents: [
      { 
        type: "text", 
        text: l, 
        color: "#aaaaaa", 
        flex: 2 
      }, 
      { 
        type: "text", 
        text: String(v), 
        color: c, 
        flex: 5, 
        weight: w 
      }
    ] 
  }; 
}

function cacheSet(u, k, v) { 
  CacheService.getScriptCache().put(u + "_" + k, String(v), 21600); 
}

function cacheGet(u, k) { 
  const v = CacheService.getScriptCache().get(u + "_" + k); 
  if (k === "qty" && v) {
    return Number(v);
  }
  return v; 
}

function clearItemData(u) { 
  CacheService.getScriptCache().removeAll([
    u + "_item", 
    u + "_qty", 
    u + "_image", 
    u + "_return_req_id"
  ]); 
}

function clearSession(u) { 
  CacheService.getScriptCache().removeAll([
    u + "_mode", 
    u + "_machine", 
    u + "_item", 
    u + "_qty", 
    u + "_image", 
    u + "_newItemStep", 
    u + "_newItemData", 
    u + "_return_req_id"
  ]); 
}

function normalizeText(text) { 
  return String(text || "")
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim(); 
}

function sendDashboardFlex(token, uid, settings) {
  let url = ScriptApp.getService().getUrl();
  if(!url) {
    return reply(token, "⚠️ ยังไม่ได้ Deploy Web");
  }
  
  const separator = url.includes('?') ? '&' : '?';
  const fullUrl = url + separator + "uid=" + uid;
  const tColor = settings.themeColor || THEME_COLOR;
  
  replyFlex(token, { 
    type: "flex", 
    altText: "Dashboard", 
    contents: { 
      type: "bubble", 
      header: { 
        type: "box", 
        layout: "vertical", 
        contents: [
          { 
            type: "text", 
            text: "📊 Dashboard", 
            weight: "bold", 
            color: "#FFFFFF" 
          }
        ], 
        backgroundColor: tColor 
      }, 
      body: { 
        type: "box", 
        layout: "vertical", 
        contents: [
          { 
            type: "button", 
            action: { 
              type: "uri", 
              label: "🌐 เปิดเว็บ", 
              uri: fullUrl 
            }, 
            style: "primary", 
            color: tColor 
          }
        ] 
      } 
    } 
  });
}

function sendHistory(token, type) {
  const rows = sheet("Logs").getDataRange().getValues().slice(1).reverse();
  
  const filteredRows = rows.filter(r => {
    let act = String(r[6]).trim();
    if (type === "Stock") {
      const itemsData = sheet("Items").getDataRange().getValues();
      const inItems = itemsData.some(i => String(i[0]).trim() === String(r[1]).trim());
      return ["เบิก", "รับเข้า", "New Item"].includes(act) || (act === "ปรับยอด" && inItems);
    } else {
      const toolsData = sheet("Tools").getDataRange().getValues();
      const inTools = toolsData.some(i => String(i[0]).trim() === String(r[1]).trim());
      return ["ยืม", "คืน", "ซ่อมแซมแล้ว", "แจ้งชำรุด"].includes(act) || (act === "ปรับยอด" && inTools);
    }
  });
  
  const f = filteredRows.slice(0, 10);
  
  if(f.length === 0) {
    return reply(token, "📭 ไม่มีประวัติ");
  }
  
  let msg = `📜 10 ประวัติล่าสุด\n`;
  f.forEach((r, i) => {
    msg += `${i+1}. [${formatDate(r[0])}] ${r[6]}\n   📦 ${r[2]} (${r[3]})\n   👤 ${r[7]}\n`;
  });
  
  reply(token, msg);
}

// ฟังก์ชันดึงสรุปรายเดือน (ให้ไปตั้ง Trigger เป็น "ทุกเดือน" วันที่ 1)
function monthlyExportTask() {
  try {
    const settings = getSettings();
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let summary = "📊 สรุปข้อมูลคลังสินค้าประจำเดือน\n\n";
    summary += "- คลังอะไหล่: " + (ss.getSheetByName("Items").getLastRow() - 1) + " รายการ\n";
    summary += "- เครื่องมือ: " + (ss.getSheetByName("Tools").getLastRow() - 1) + " รายการ\n";
    summary += "- การเคลื่อนไหว: " + (ss.getSheetByName("Logs").getLastRow() - 1) + " รายการ\n";
    
    const backupData = JSON.stringify(webGetBackupData().data);
    const fName = `AutoBackup_CFactory_${new Date().toISOString().split('T')[0]}.json`;
    const f = getSubFolder(DriveApp.getFolderById(FOLDER_ID), "Monthly_Backups").createFile(fName, backupData, MimeType.PLAIN_TEXT);
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    summary += `\n📁 ไฟล์สำรองข้อมูล: ${f.getUrl()}`;
    
    // แจ้งเตือนเข้าไลน์กลุ่มถ้ามี Token
    if(settings.lineNotifyToken) {
      sendLineNotify(summary, settings.lineNotifyToken);
    }
  } catch(e) {
    console.error("Export Task Error: " + e);
  }
}

// ฟังก์ชันสรุปของใกล้หมด (ให้ไปตั้ง Trigger เป็น "ทุกวัน" ตอนเช้า)
function dailyDigestTask() {
  try {
    const settings = getSettings();
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const items = ss.getSheetByName("Items").getDataRange().getValues().slice(1);
    const tools = ss.getSheetByName("Tools").getDataRange().getValues().slice(1);
    
    let lowItems = items.filter(r => Number(r[5]) <= Number(r[4]) && String(r[0]).trim() !== "");
    let lowTools = tools.filter(r => Number(r[5]) <= Number(r[4]) && String(r[0]).trim() !== "");
    
    if ((lowItems.length > 0 || lowTools.length > 0) && settings.lineNotifyToken) {
      let msg = "\n⚠️ รายการสินค้าใกล้หมดประจำวัน:\n";
      lowItems.forEach(i => msg += `- ${i[1]} (เหลือ ${i[5]})\n`);
      lowTools.forEach(i => msg += `- ${i[1]} (เหลือ ${i[5]})\n`);
      sendLineNotify(msg, settings.lineNotifyToken);
    }
  } catch(e) {
    console.error("Daily Digest Task Error: " + e);
  }
}
// =====================================================================
// เพิ่มฟังก์ชันใหม่สำหรับระบบ "ตะกร้าสินค้า" (ไม่กระทบระบบเดิม)
// =====================================================================
function webBatchTransaction(payloads) {
  try {
    const errors = [];
    let successCount = 0;

    // วนลูปบันทึกข้อมูลทีละรายการในตะกร้า
    for (let i = 0; i < payloads.length; i++) {
      const p = payloads[i];
      const code = p.code;
      const qty = Number(p.qty);
      const type = p.type; // "เบิก", "รับเข้า", "ยืม"
      const user = p.user;
      const uid = p.uid || "WEB_SCANNER";
      const remark = p.remark;

      // 1. ดึงข้อมูลสินค้า
      const itemInfo = getItemInfo(code);
      if (!itemInfo || !itemInfo.code) {
         errors.push(`ไม่พบรหัส ${code}`);
         continue;
      }

      // 2. แยกตามประเภทการทำรายการ (ยืม / เบิก / รับเข้า)
      if (type === "ยืม") {
         if (itemInfo.stock < qty) {
            errors.push(`สต็อกไม่พอสำหรับ ${itemInfo.name}`);
            continue;
         }
         // ตัดสต็อก
         updateStock(code, qty, "ยืม", user);
         
         // บันทึกลงชีตยืม
         sheet("BorrowRequests").appendRow([
            "BW" + Date.now() + i,
            new Date(),
            uid,
            user,
            code,
            itemInfo.name,
            qty,
            itemInfo.category || "-",
            "Web Scanner",
            "approved",
            new Date(),
            remark || "ยืมผ่านระบบสแกน"
         ]);
         successCount++;
         
      } else {
         // สำหรับ "เบิก" และ "รับเข้า"
         if (type === "เบิก" && itemInfo.stock < qty) {
            errors.push(`สต็อกไม่พอสำหรับ ${itemInfo.name}`);
            continue;
         }
         
         // ตัดสต็อก/เพิ่มสต็อก (ฟังก์ชันเดิมของคุณ)
         updateStock(code, qty, type, user);

         const transId = (type === "รับเข้า" ? "RC" : "WD") + Date.now() + i;

         // บันทึกลงชีตรับเข้า หรือ เบิก
         if (type === "รับเข้า") {
            sheet("Receives").appendRow([
              transId, new Date(), uid, user, type, code, itemInfo.name, qty, itemInfo.category, "Web Scanner", "approved"
            ]);
         } else {
            sheet("Requests").appendRow([
              transId, new Date(), uid, user, code, itemInfo.name, qty, itemInfo.category, "Web Scanner"
            ]);
         }

         // อัปเดตหมายเหตุ (Remark) ลงใน Logs ช่อง I (และต่อท้ายช่อง H เหมือนระบบเดิม)
         if (remark) {
           const logSheet = sheet("Logs");
           const lastRow = logSheet.getLastRow();
           logSheet.getRange(lastRow, 9).setValue(remark);
           logSheet.getRange(lastRow, 8).setValue(`${user} [${remark}]`);
         }
         successCount++;
      }
    }

    // 3. ตรวจสอบผลลัพธ์
    if (errors.length > 0 && successCount === 0) {
       return { success: false, error: errors.join(", ") };
    } else if (errors.length > 0) {
       // สำเร็จบางส่วน
       return { success: true, error: "สำเร็จบางส่วน แต่มีข้อผิดพลาด: " + errors.join(", ") };
    }

    return { success: true };
    
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}