const SHEET_NAME = '健康數據';

function doPost(e) {
  try {
    let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(SHEET_NAME);
      // 🚀 新增了「太暗次數」
      sheet.appendRow(['日期', '專注時長(秒)', '番茄鐘數', '閉眼次數', '高低肩次數', '太近次數', '哈欠次數', '太暗次數']);
    }
    
    let data = JSON.parse(e.postData.contents);
    sheet.appendRow([
      data.date, 
      data.work_time, 
      data.pomodoros, 
      data.eyes, 
      data.shoulders, 
      data.dist, 
      data.mouth,
      data.light // 🚀 寫入光線數據
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({"status": "success"})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({"error": err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
  
  let data = sheet.getDataRange().getValues();
  let headers = data[0];
  let result = [];
  
  for(let i = 1; i < data.length; i++) {
    let row = data[i];
    let obj = {};
    for(let j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j];
    }
    result.push(obj);
  }
  
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}