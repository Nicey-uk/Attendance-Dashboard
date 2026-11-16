/*
 * ============================================================================
 * WDC Smart Attendance System — ESP32-CAM + RC522 RFID + SD_MMC Web Dashboard
 * ============================================================================
 * Board      : AI-Thinker ESP32-CAM (Arduino IDE, Partition: Huge APP)
 * Server     : WebServer.h (Synchronous, chunked streaming, low RAM footprint)
 * RFID       : RC522 on SPI (SCK=14, MISO=12, MOSI=13, SS=15, RST=16)
 * Buzzer     : Active 5V Buzzer on GPIO 2
 * Storage    : MicroSD (FAT32) via SD_MMC 1-bit mode
 * Timezone   : Philippine Standard Time (GMT+8 via NTP)
 * ============================================================================
 */

#include "esp_camera.h"
#include <WiFi.h>
#include <WebServer.h>
#include <SPI.h>
#include <MFRC522.h>
#include "FS.h"
#include "SD_MMC.h"
#include <time.h>

// ================= WIFI CONFIGURATION =================
const char* ssid     = "YOUR_HOTSPOT_NAME";
const char* password = "YOUR_HOTSPOT_PASSWORD";

// ================= PIN ASSIGNMENTS ====================
#define SS_PIN     15
#define RST_PIN    16
#define BUZZER_PIN 2

// AI-Thinker ESP32-CAM Camera Pins
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

MFRC522 rfid(SS_PIN, RST_PIN);
WebServer server(80);

// ================= IN-MEMORY COMPACT ROSTER & SCHEDULE =================
#define MAX_STUDENTS 60
#define MAX_SCHEDULES 24

struct StudentRecord {
  char uid[16];
  char name[40];
  char className[20];
  char section[20];
};

struct ScheduleItem {
  char id[20];
  char subject[36];
  char className[20];
  char section[20];
  char day[6];    // Mon, Tue, Wed, Thu, Fri, Sat
  char start[8];  // HH:MM
  char end[8];    // HH:MM
  char room[20];
  int  grace;     // default 15 min
};

StudentRecord students[MAX_STUDENTS];
int studentCount = 0;

ScheduleItem schedules[MAX_SCHEDULES];
int scheduleCount = 0;

// Duplicate Tap Guard (ignore same UID within 60 seconds)
struct TapCooldown {
  char uid[16];
  unsigned long lastTapMs;
};
TapCooldown tapHistory[MAX_STUDENTS];
int tapHistoryCount = 0;

// Active "Take Attendance" Session State
struct AttendanceSession {
  bool active;
  char date[12];
  char className[20];
  char subject[36];
  char section[20];
  char startedAt[10];
} currentSession = { false, "", "", "", "", "" };

// ================= FUNCTION PROTOTYPES =================
void initCamera();
void ensureSdStructure();
void loadStudentsFromSD();
void loadScheduleFromSD();
int  findStudentIndex(const char* uid);
bool isDuplicateTap(const char* uid);
char computeTapStatus(const char* dateStr, const char* timeStr, const char* className, const char* subject, const char* section);
int  hhmmToMinutes(const char* hhmm);
void getCurrentDateTimePHT(char* outDate, size_t dateLen, char* outTime, size_t timeLen, char* outDay, size_t dayLen);

// HTTP Route Handlers
void handleRoot();
void handleAppCss();
void handleAppJs();
void handleGetStudents();
void handlePostStudents();
void handleDeleteStudent();
void handleGetSchedule();
void handlePostSchedule();
void handleDeleteSchedule();
void handleApiSummary();
void handleApiAttendance();
void handlePostStatus();
void handlePostSession();
void handlePhoto();
void handleDownloadCSV();

// ============================================================================
// SETUP
// ============================================================================
void setup() {
  Serial.begin(115200);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // 1. Mount MicroSD Card in 1-bit mode (leaves GPIO 12, 13, 15 free for RC522 SPI)
  if (!SD_MMC.begin("/sdcard", true)) {
    Serial.println("[ERROR] SD Card Mount Failed! Ensure FAT32 formatting.");
  } else {
    Serial.println("[OK] SD Card Initialized in 1-bit mode.");
    ensureSdStructure();
    loadStudentsFromSD();
    loadScheduleFromSD();
  }

  // 2. Initialize OV2640 Camera (QVGA 320x240 JPEG)
  initCamera();

  // 3. Initialize RC522 RFID on SPI (SCK=14, MISO=12, MOSI=13, SS=15)
  SPI.begin(14, 12, 13, 15);
  rfid.PCD_Init();
  Serial.println("[OK] RC522 RFID Reader Initialized.");

  // 4. Connect to Phone Hotspot
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n[OK] Wi-Fi Connected!");
  Serial.print("Open WDC Dashboard at: http://");
  Serial.println(WiFi.localIP());

  // 5. Configure NTP Time (Philippine Time GMT+8 = 28800 sec)
  configTime(28800, 0, "pool.ntp.org", "time.nist.gov");

  // 6. Register WebServer.h Routes
  server.on("/", HTTP_GET, handleRoot);
  server.on("/index.html", HTTP_GET, handleRoot);
  server.on("/app.css", HTTP_GET, handleAppCss);
  server.on("/app.js", HTTP_GET, handleAppJs);

  server.on("/api/summary", HTTP_GET, handleApiSummary);
  server.on("/api/attendance", HTTP_GET, handleApiAttendance);
  server.on("/api/status", HTTP_POST, handlePostStatus);
  server.on("/api/session", HTTP_POST, handlePostSession);
  server.on("/api/students", HTTP_GET, handleGetStudents);
  server.on("/api/students", HTTP_POST, handlePostStudents);
  server.on("/api/students", HTTP_DELETE, handleDeleteStudent);

  server.on("/api/schedule", HTTP_GET, handleGetSchedule);
  server.on("/api/schedule", HTTP_POST, handlePostSchedule);
  server.on("/api/schedule", HTTP_DELETE, handleDeleteSchedule);

  server.on("/photo", HTTP_GET, handlePhoto);
  server.on("/export", HTTP_GET, handleDownloadCSV);

  server.begin();
  Serial.println("[OK] HTTP WebServer started on port 80.");

  // Readiness beep
  digitalWrite(BUZZER_PIN, HIGH);
  delay(150);
  digitalWrite(BUZZER_PIN, LOW);
}

// ============================================================================
// MAIN LOOP (WebServer + Non-Blocking RFID Poll)
// ============================================================================
void loop() {
  server.handleClient();

  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) {
    return;
  }

  // Read Card UID in Uppercase Hex
  String cardUID = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) cardUID += "0";
    cardUID += String(rfid.uid.uidByte[i], HEX);
  }
  cardUID.toUpperCase();
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  // Check 60-second duplicate tap protection
  if (isDuplicateTap(cardUID.c_str())) {
    Serial.printf("[SKIP] Duplicate tap ignored (<60s) for UID: %s\n", cardUID.c_str());
    return;
  }

  // Lookup student from /students.json loaded in RAM
  int idx = findStudentIndex(cardUID.c_str());
  const char* studentName = (idx >= 0) ? students[idx].name : "Unregistered User";
  const char* studentClass = (idx >= 0) ? students[idx].className : (currentSession.active ? currentSession.className : "BSCS 3");
  const char* studentSection = (idx >= 0) ? students[idx].section : (currentSession.active ? currentSession.section : "Section A");
  const char* activeSubj = currentSession.active ? currentSession.subject : "";

  // Capture QVGA JPEG Frame
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[ERROR] Camera capture failed!");
    return;
  }

  // Generate GMT+8 Timestamp & Photo Path inside /photos/
  struct tm timeinfo;
  char dateString[12]  = "2026-11-16";
  char clockString[10] = "08:00:00";
  char photoName[48];

  if (getLocalTime(&timeinfo, 200)) {
    strftime(dateString, sizeof(dateString), "%Y-%m-%d", &timeinfo);
    strftime(clockString, sizeof(clockString), "%H:%M:%S", &timeinfo);
    strftime(photoName, sizeof(photoName), "/photos/photo_%Y%m%d_%H%M%S.jpg", &timeinfo);
  } else {
    snprintf(photoName, sizeof(photoName), "/photos/photo_%lu.jpg", millis());
  }

  // Save JPEG to /photos/ on MicroSD
  File photoFile = SD_MMC.open(photoName, FILE_WRITE);
  if (photoFile) {
    photoFile.write(fb->buf, fb->len);
    photoFile.close();
  }
  esp_camera_fb_return(fb);

  // Determine Present ('P') vs Late ('L') using schedule grace period
  char statusChar = computeTapStatus(dateString, clockString, studentClass, activeSubj, studentSection);

  // Append row to /attendance.csv
  // Columns: UID,Name,Date,Time,PhotoPath,Status,Class,Subject,Section
  File csvFile = SD_MMC.open("/attendance.csv", FILE_APPEND);
  if (csvFile) {
    csvFile.printf("%s,%s,%s,%s,%s,%c,%s,%s,%s\n",
      cardUID.c_str(),
      studentName,
      dateString,
      clockString,
      photoName,
      statusChar,
      studentClass,
      activeSubj,
      studentSection
    );
    csvFile.close();
  }

  // 100ms Active Buzzer Beep
  digitalWrite(BUZZER_PIN, HIGH);
  delay(100);
  digitalWrite(BUZZER_PIN, LOW);

  Serial.printf("[TAP] %s (%s) -> %c at %s %s (%s)\n",
    studentName, cardUID.c_str(), statusChar, dateString, clockString, photoName);
}

// ============================================================================
// SD CARD FILESYSTEM & JSON PARSING HELPERS (No heavy JSON library needed)
// ============================================================================
void ensureSdStructure() {
  if (!SD_MMC.exists("/photos")) {
    SD_MMC.mkdir("/photos");
  }
  if (!SD_MMC.exists("/www")) {
    SD_MMC.mkdir("/www");
  }
  if (!SD_MMC.exists("/attendance.csv")) {
    File f = SD_MMC.open("/attendance.csv", FILE_WRITE);
    if (f) {
      f.println("UID,Name,Date,Time,PhotoPath,Status,Class,Subject,Section");
      f.close();
    }
  }
}

// Lightweight JSON key extractor for flat JSON objects in /students.json & /schedule.json
String extractJsonString(const String& obj, const char* key) {
  String pattern = String("\"") + key + "\"";
  int kPos = obj.indexOf(pattern);
  if (kPos == -1) return "";
  int colon = obj.indexOf(':', kPos + pattern.length());
  if (colon == -1) return "";
  int qStart = obj.indexOf('"', colon + 1);
  if (qStart == -1) return "";
  int qEnd = obj.indexOf('"', qStart + 1);
  if (qEnd == -1) return "";
  return obj.substring(qStart + 1, qEnd);
}

int extractJsonInt(const String& obj, const char* key, int defaultVal) {
  String pattern = String("\"") + key + "\"";
  int kPos = obj.indexOf(pattern);
  if (kPos == -1) return defaultVal;
  int colon = obj.indexOf(':', kPos + pattern.length());
  if (colon == -1) return defaultVal;
  int i = colon + 1;
  while (i < (int)obj.length() && (obj[i] == ' ' || obj[i] == '"')) i++;
  String num = "";
  while (i < (int)obj.length() && isDigit(obj[i])) {
    num += obj[i++];
  }
  return num.length() > 0 ? num.toInt() : defaultVal;
}

void loadStudentsFromSD() {
  studentCount = 0;
  File f = SD_MMC.open("/students.json", FILE_READ);
  if (!f) {
    Serial.println("[WARN] /students.json not found on SD card.");
    return;
  }
  while (f.available() && studentCount < MAX_STUDENTS) {
    String obj = f.readStringUntil('}');
    int openBrace = obj.indexOf('{');
    if (openBrace == -1) continue;
    obj = obj.substring(openBrace);

    String uid = extractJsonString(obj, "uid");
    String name = extractJsonString(obj, "name");
    String cls = extractJsonString(obj, "class");
    String sec = extractJsonString(obj, "section");
    if (uid.length() > 0 && name.length() > 0) {
      uid.toUpperCase();
      strlcpy(students[studentCount].uid, uid.c_str(), sizeof(students[0].uid));
      strlcpy(students[studentCount].name, name.c_str(), sizeof(students[0].name));
      strlcpy(students[studentCount].className, cls.length() ? cls.c_str() : "BSCS 3", sizeof(students[0].className));
      strlcpy(students[studentCount].section, sec.length() ? sec.c_str() : "Section A", sizeof(students[0].section));
      studentCount++;
    }
  }
  f.close();
  Serial.printf("[OK] Loaded %d students from /students.json\n", studentCount);
}

void loadScheduleFromSD() {
  scheduleCount = 0;
  File f = SD_MMC.open("/schedule.json", FILE_READ);
  if (!f) {
    Serial.println("[WARN] /schedule.json not found on SD card.");
    return;
  }
  while (f.available() && scheduleCount < MAX_SCHEDULES) {
    String obj = f.readStringUntil('}');
    int openBrace = obj.indexOf('{');
    if (openBrace == -1) continue;
    obj = obj.substring(openBrace);

    String subj = extractJsonString(obj, "subject");
    if (subj.length() == 0) continue;

    strlcpy(schedules[scheduleCount].id, extractJsonString(obj, "id").c_str(), sizeof(schedules[0].id));
    strlcpy(schedules[scheduleCount].subject, subj.c_str(), sizeof(schedules[0].subject));
    strlcpy(schedules[scheduleCount].className, extractJsonString(obj, "class").c_str(), sizeof(schedules[0].className));
    strlcpy(schedules[scheduleCount].section, extractJsonString(obj, "section").c_str(), sizeof(schedules[0].section));
    strlcpy(schedules[scheduleCount].day, extractJsonString(obj, "day").c_str(), sizeof(schedules[0].day));
    strlcpy(schedules[scheduleCount].start, extractJsonString(obj, "start").c_str(), sizeof(schedules[0].start));
    strlcpy(schedules[scheduleCount].end, extractJsonString(obj, "end").c_str(), sizeof(schedules[0].end));
    strlcpy(schedules[scheduleCount].room, extractJsonString(obj, "room").c_str(), sizeof(schedules[0].room));
    schedules[scheduleCount].grace = extractJsonInt(obj, "grace", 15);
    scheduleCount++;
  }
  f.close();
  Serial.printf("[OK] Loaded %d classes from /schedule.json\n", scheduleCount);
}

int findStudentIndex(const char* uid) {
  for (int i = 0; i < studentCount; i++) {
    if (strcasecmp(students[i].uid, uid) == 0) return i;
  }
  return -1;
}

bool isDuplicateTap(const char* uid) {
  unsigned long now = millis();
  for (int i = 0; i < tapHistoryCount; i++) {
    if (strcasecmp(tapHistory[i].uid, uid) == 0) {
      if (now - tapHistory[i].lastTapMs < 60000UL) {
        return true; // Duplicate within 60 seconds
      }
      tapHistory[i].lastTapMs = now;
      return false;
    }
  }
  if (tapHistoryCount < MAX_STUDENTS) {
    strlcpy(tapHistory[tapHistoryCount].uid, uid, sizeof(tapHistory[0].uid));
    tapHistory[tapHistoryCount].lastTapMs = now;
    tapHistoryCount++;
  }
  return false;
}

int hhmmToMinutes(const char* hhmm) {
  if (!hhmm || strlen(hhmm) < 4) return 480; // default 08:00
  int h = atoi(hhmm);
  const char* colon = strchr(hhmm, ':');
  int m = colon ? atoi(colon + 1) : 0;
  return h * 60 + m;
}

void getCurrentDateTimePHT(char* outDate, size_t dateLen, char* outTime, size_t timeLen, char* outDay, size_t dayLen) {
  struct tm timeinfo;
  if (getLocalTime(&timeinfo, 100)) {
    if (outDate) strftime(outDate, dateLen, "%Y-%m-%d", &timeinfo);
    if (outTime) strftime(outTime, timeLen, "%H:%M:%S", &timeinfo);
    if (outDay)  strftime(outDay, dayLen, "%a", &timeinfo);
  } else {
    if (outDate) strlcpy(outDate, "2026-11-16", dateLen);
    if (outTime) strlcpy(outTime, "08:00:00", timeLen);
    if (outDay)  strlcpy(outDay, "Mon", dayLen);
  }
}

char computeTapStatus(const char* dateStr, const char* timeStr, const char* className, const char* subject, const char* section) {
  char dayShort[6] = "Mon";
  char tmpDate[12], tmpTime[10];
  getCurrentDateTimePHT(tmpDate, sizeof(tmpDate), tmpTime, sizeof(tmpTime), dayShort, sizeof(dayShort));

  int tapMins = hhmmToMinutes(timeStr);
  int startMins = 8 * 60; // default 08:00 AM
  int graceMins = 15;     // default 15 min grace period

  for (int i = 0; i < scheduleCount; i++) {
    bool subjMatch = (!subject || strlen(subject) == 0 || strcasecmp(schedules[i].subject, subject) == 0);
    bool clsMatch  = (!className || strlen(className) == 0 || strcasecmp(schedules[i].className, className) == 0);
    bool dayMatch  = (strcasecmp(schedules[i].day, dayShort) == 0);
    if ((subject && strlen(subject) > 0 && subjMatch && clsMatch) || (dayMatch && clsMatch)) {
      startMins = hhmmToMinutes(schedules[i].start);
      graceMins = schedules[i].grace > 0 ? schedules[i].grace : 15;
      break;
    }
  }

  return (tapMins > (startMins + graceMins)) ? 'L' : 'P';
}

// Parse a CSV line into up to 9 fields
void parseCsvLine(const String& line, String cols[9]) {
  for (int i = 0; i < 9; i++) cols[i] = "";
  int col = 0;
  int start = 0;
  int len = line.length();
  while (start <= len && col < 9) {
    int comma = line.indexOf(',', start);
    if (comma == -1) {
      cols[col] = line.substring(start);
      cols[col].trim();
      break;
    } else {
      cols[col] = line.substring(start, comma);
      cols[col].trim();
      start = comma + 1;
      col++;
    }
  }
}

// Upsert a student's status row in /attendance.csv using a temporary file so RAM usage stays near 0
void upsertAttendanceCsvRow(const String& uid, const String& name, const String& date, const String& timeStr, const String& status, const String& cls, const String& subj, const String& sec) {
  File inFile = SD_MMC.open("/attendance.csv", FILE_READ);
  File outFile = SD_MMC.open("/attendance.tmp", FILE_WRITE);
  if (!outFile) {
    if (inFile) inFile.close();
    return;
  }

  bool updated = false;
  String keepPhoto = "";

  if (inFile) {
    while (inFile.available()) {
      String line = inFile.readStringUntil('\n');
      line.trim();
      if (line.length() == 0) continue;
      if (line.startsWith("UID,")) {
        outFile.println("UID,Name,Date,Time,PhotoPath,Status,Class,Subject,Section");
        continue;
      }
      String cols[9];
      parseCsvLine(line, cols);
      if (cols[0].equalsIgnoreCase(uid) && cols[2] == date) {
        if (cols[4].length() > 0) keepPhoto = cols[4];
        outFile.printf("%s,%s,%s,%s,%s,%s,%s,%s,%s\n",
          uid.c_str(),
          name.c_str(),
          date.c_str(),
          cols[3].length() ? cols[3].c_str() : timeStr.c_str(),
          keepPhoto.c_str(),
          status.c_str(),
          cls.c_str(),
          subj.c_str(),
          sec.c_str()
        );
        updated = true;
      } else {
        outFile.println(line);
      }
    }
    inFile.close();
  } else {
    outFile.println("UID,Name,Date,Time,PhotoPath,Status,Class,Subject,Section");
  }

  if (!updated) {
    outFile.printf("%s,%s,%s,%s,,%s,%s,%s,%s\n",
      uid.c_str(), name.c_str(), date.c_str(), timeStr.c_str(),
      status.c_str(), cls.c_str(), subj.c_str(), sec.c_str()
    );
  }
  outFile.close();

  SD_MMC.remove("/attendance.csv");
  SD_MMC.rename("/attendance.tmp", "/attendance.csv");
}

// ============================================================================
// STATIC FILE & API ROUTE HANDLERS (Streamed from SD Card)
// ============================================================================
void handleRoot() {
  File f = SD_MMC.open("/www/index.html", FILE_READ);
  if (!f) {
    server.send(404, "text/plain", "Missing /www/index.html on SD card");
    return;
  }
  server.streamFile(f, "text/html");
  f.close();
}

void handleAppCss() {
  File f = SD_MMC.open("/www/app.css", FILE_READ);
  if (!f) {
    server.send(404, "text/plain", "Missing /www/app.css");
    return;
  }
  server.streamFile(f, "text/css");
  f.close();
}

void handleAppJs() {
  File f = SD_MMC.open("/www/app.js", FILE_READ);
  if (!f) {
    server.send(404, "text/plain", "Missing /www/app.js");
    return;
  }
  server.streamFile(f, "application/javascript");
  f.close();
}

void handleGetStudents() {
  File f = SD_MMC.open("/students.json", FILE_READ);
  if (!f) {
    server.send(200, "application/json", "[]");
    return;
  }
  server.streamFile(f, "application/json");
  f.close();
}

void handlePostStudents() {
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"error\":\"Missing body\"}");
    return;
  }
  String body = server.arg("plain");
  if (body.startsWith("[")) {
    File f = SD_MMC.open("/students.json", FILE_WRITE);
    if (!f) {
      server.send(500, "application/json", "{\"error\":\"SD write failed\"}");
      return;
    }
    f.print(body);
    f.close();
  } else {
    String uid = extractJsonString(body, "uid");
    String name = extractJsonString(body, "name");
    String cls = extractJsonString(body, "class");
    String sec = extractJsonString(body, "section");
    if (uid.length() == 0 || name.length() == 0) {
      server.send(400, "application/json", "{\"error\":\"Missing uid or name\"}");
      return;
    }
    uid.toUpperCase();

    int existing = findStudentIndex(uid.c_str());
    if (existing >= 0) {
      strlcpy(students[existing].name, name.c_str(), sizeof(students[0].name));
      strlcpy(students[existing].className, cls.length() ? cls.c_str() : "BSCS 3", sizeof(students[0].className));
      strlcpy(students[existing].section, sec.length() ? sec.c_str() : "Section A", sizeof(students[0].section));
    } else if (studentCount < MAX_STUDENTS) {
      strlcpy(students[studentCount].uid, uid.c_str(), sizeof(students[0].uid));
      strlcpy(students[studentCount].name, name.c_str(), sizeof(students[0].name));
      strlcpy(students[studentCount].className, cls.length() ? cls.c_str() : "BSCS 3", sizeof(students[0].className));
      strlcpy(students[studentCount].section, sec.length() ? sec.c_str() : "Section A", sizeof(students[0].section));
      studentCount++;
    }

    File f = SD_MMC.open("/students.json", FILE_WRITE);
    if (f) {
      f.println("[");
      for (int i = 0; i < studentCount; i++) {
        f.printf("  {\"uid\":\"%s\",\"name\":\"%s\",\"class\":\"%s\",\"section\":\"%s\"}%s\n",
          students[i].uid, students[i].name, students[i].className, students[i].section,
          (i < studentCount - 1) ? "," : ""
        );
      }
      f.println("]");
      f.close();
    }
  }

  loadStudentsFromSD();
  server.send(200, "application/json", "{\"ok\":true}");
}

void handleDeleteStudent() {
  String delUid = server.arg("uid");
  if (delUid.length() == 0) {
    server.send(400, "application/json", "{\"error\":\"Missing uid\"}");
    return;
  }
  delUid.toUpperCase();
  int idx = findStudentIndex(delUid.c_str());
  if (idx >= 0) {
    for (int i = idx; i < studentCount - 1; i++) {
      students[i] = students[i + 1];
    }
    studentCount--;

    File f = SD_MMC.open("/students.json", FILE_WRITE);
    if (f) {
      f.println("[");
      for (int i = 0; i < studentCount; i++) {
        f.printf("  {\"uid\":\"%s\",\"name\":\"%s\",\"class\":\"%s\",\"section\":\"%s\"}%s\n",
          students[i].uid, students[i].name, students[i].className, students[i].section,
          (i < studentCount - 1) ? "," : ""
        );
      }
      f.println("]");
      f.close();
    }
  }
  loadStudentsFromSD();
  server.send(200, "application/json", "{\"ok\":true}");
}

void handleGetSchedule() {
  File f = SD_MMC.open("/schedule.json", FILE_READ);
  if (!f) {
    server.send(200, "application/json", "[]");
    return;
  }
  server.streamFile(f, "application/json");
  f.close();
}

void handlePostSchedule() {
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"error\":\"Missing body\"}");
    return;
  }
  File f = SD_MMC.open("/schedule.json", FILE_WRITE);
  if (!f) {
    server.send(500, "application/json", "{\"error\":\"SD write failed\"}");
    return;
  }
  f.print(server.arg("plain"));
  f.close();
  loadScheduleFromSD();
  server.send(200, "application/json", "{\"ok\":true}");
}

void handleDeleteSchedule() {
  String delId = server.arg("id");
  if (delId.length() == 0) {
    server.send(400, "application/json", "{\"error\":\"Missing id\"}");
    return;
  }
  File inFile = SD_MMC.open("/schedule.json", FILE_READ);
  File outFile = SD_MMC.open("/schedule.tmp", FILE_WRITE);
  if (!inFile || !outFile) {
    if (inFile) inFile.close();
    if (outFile) outFile.close();
    server.send(500, "application/json", "{\"error\":\"SD open failed\"}");
    return;
  }
  outFile.println("[");
  bool first = true;
  while (inFile.available()) {
    String obj = inFile.readStringUntil('}');
    int ob = obj.indexOf('{');
    if (ob == -1) continue;
    obj = obj.substring(ob) + "}";
    String id = extractJsonString(obj, "id");
    if (id == delId) continue;
    if (!first) outFile.println(",");
    outFile.print(obj);
    first = false;
  }
  outFile.println("\n]");
  inFile.close();
  outFile.close();

  SD_MMC.remove("/schedule.json");
  SD_MMC.rename("/schedule.tmp", "/schedule.json");
  loadScheduleFromSD();
  server.send(200, "application/json", "{\"ok\":true}");
}

// GET /api/attendance?date=YYYY-MM-DD&class=&subject=&section=
// Streams JSON in chunks so ESP32 heap stays free
void handleApiAttendance() {
  char todayDate[12], nowTime[10], dayShort[6];
  getCurrentDateTimePHT(todayDate, sizeof(todayDate), nowTime, sizeof(nowTime), dayShort, sizeof(dayShort));

  String qDate = server.arg("date");
  if (qDate.length() == 0) qDate = String(todayDate);
  String qClass = server.arg("class");
  String qSubj  = server.arg("subject");
  String qSec   = server.arg("section");

  // Per-student state arrays for the requested date
  char stStatus[MAX_STUDENTS];
  char stTime[MAX_STUDENTS][10];
  char stPhoto[MAX_STUDENTS][44];

  for (int i = 0; i < studentCount; i++) {
    stStatus[i] = '\0';
    stTime[i][0] = '\0';
    stPhoto[i][0] = '\0';
  }

  // Scan /attendance.csv line-by-line
  File csv = SD_MMC.open("/attendance.csv", FILE_READ);
  if (csv) {
    while (csv.available()) {
      String line = csv.readStringUntil('\n');
      line.trim();
      if (line.length() < 5 || line.startsWith("UID,")) continue;

      String cols[9];
      parseCsvLine(line, cols);
      int idx = findStudentIndex(cols[0].c_str());
      if (idx < 0) continue;

      // Always track most recent photo for student avatar
      if (cols[4].length() > 0) {
        strlcpy(stPhoto[idx], cols[4].c_str(), sizeof(stPhoto[0]));
      }

      if (cols[2] == qDate) {
        if (qSubj.length() > 0 && cols[7].length() > 0 && !cols[7].equalsIgnoreCase(qSubj)) {
          continue;
        }
        strlcpy(stTime[idx], cols[3].c_str(), sizeof(stTime[0]));
        if (cols[5].length() > 0) {
          stStatus[idx] = cols[5][0];
        } else {
          stStatus[idx] = computeTapStatus(cols[2].c_str(), cols[3].c_str(), students[idx].className, qSubj.c_str(), students[idx].section);
        }
      }
    }
    csv.close();
  }

  // Begin chunked JSON response
  server.setContentLength(CONTENT_LENGTH_UNKNOWN);
  server.send(200, "application/json", "");

  char chunk[256];
  snprintf(chunk, sizeof(chunk),
    "{\"date\":\"%s\",\"session\":{\"active\":%s,\"class\":\"%s\",\"subject\":\"%s\",\"section\":\"%s\"},\"students\":[",
    qDate.c_str(),
    currentSession.active ? "true" : "false",
    currentSession.className,
    currentSession.subject,
    currentSession.section
  );
  server.sendContent(chunk);

  bool first = true;
  for (int i = 0; i < studentCount; i++) {
    if (qClass.length() > 0 && !qClass.equalsIgnoreCase(students[i].className)) continue;
    if (qSec.length() > 0 && !qSec.equalsIgnoreCase(students[i].section)) continue;

    char statusStr[2] = { stStatus[i], '\0' };
    snprintf(chunk, sizeof(chunk),
      "%s{\"uid\":\"%s\",\"name\":\"%s\",\"class\":\"%s\",\"section\":\"%s\",\"time\":\"%s\",\"status\":\"%s\",\"photo\":\"%s\"}",
      first ? "" : ",",
      students[i].uid,
      students[i].name,
      students[i].className,
      students[i].section,
      stTime[i],
      statusStr,
      stPhoto[i]
    );
    server.sendContent(chunk);
    first = false;
  }

  server.sendContent("]}");
  server.sendContent("");
}

// GET /api/summary -> JSON stats for Dashboard + Last 10 Taps
void handleApiSummary() {
  char todayDate[12], nowTime[10], dayShort[6];
  getCurrentDateTimePHT(todayDate, sizeof(todayDate), nowTime, sizeof(nowTime), dayShort, sizeof(dayShort));

  char todayStatus[MAX_STUDENTS];
  for (int i = 0; i < studentCount; i++) todayStatus[i] = '\0';

  struct RecentTap {
    char uid[16];
    char name[40];
    char time[10];
    char photo[44];
    char status;
  };
  RecentTap recent[10];
  int recentTotal = 0;

  File csv = SD_MMC.open("/attendance.csv", FILE_READ);
  if (csv) {
    while (csv.available()) {
      String line = csv.readStringUntil('\n');
      line.trim();
      if (line.length() < 5 || line.startsWith("UID,")) continue;

      String cols[9];
      parseCsvLine(line, cols);
      char stChar = cols[5].length() > 0
        ? cols[5][0]
        : computeTapStatus(cols[2].c_str(), cols[3].c_str(), cols[6].c_str(), cols[7].c_str(), cols[8].c_str());

      int sIdx = findStudentIndex(cols[0].c_str());
      if (sIdx >= 0 && cols[2] == String(todayDate)) {
        todayStatus[sIdx] = stChar;
      }

      if (stChar != 'A') {
        int slot = recentTotal % 10;
        strlcpy(recent[slot].uid, cols[0].c_str(), sizeof(recent[0].uid));
        strlcpy(recent[slot].name, cols[1].c_str(), sizeof(recent[0].name));
        strlcpy(recent[slot].time, cols[3].c_str(), sizeof(recent[0].time));
        strlcpy(recent[slot].photo, cols[4].c_str(), sizeof(recent[0].photo));
        recent[slot].status = stChar;
        recentTotal++;
      }
    }
    csv.close();
  }

  int pCount = 0, lCount = 0, aCount = 0;
  for (int i = 0; i < studentCount; i++) {
    if (todayStatus[i] == 'P') pCount++;
    else if (todayStatus[i] == 'L') lCount++;
    else if (todayStatus[i] == 'A') aCount++;
  }
  int rate = (studentCount > 0) ? (((pCount + lCount) * 100) / studentCount) : 0;

  server.setContentLength(CONTENT_LENGTH_UNKNOWN);
  server.send(200, "application/json", "");

  char buf[256];
  snprintf(buf, sizeof(buf),
    "{\"totalStudents\":%d,\"presentToday\":%d,\"absentToday\":%d,\"lateToday\":%d,\"attendanceRate\":%d,\"recentTaps\":[",
    studentCount, pCount, aCount, lCount, rate
  );
  server.sendContent(buf);

  int countToSend = (recentTotal < 10) ? recentTotal : 10;
  bool first = true;
  for (int k = 0; k < countToSend; k++) {
    int idx = (recentTotal - 1 - k) % 10;
    snprintf(buf, sizeof(buf),
      "%s{\"uid\":\"%s\",\"name\":\"%s\",\"time\":\"%s\",\"photo\":\"%s\",\"status\":\"%c\"}",
      first ? "" : ",",
      recent[idx].uid,
      recent[idx].name,
      recent[idx].time,
      recent[idx].photo,
      recent[idx].status
    );
    server.sendContent(buf);
    first = false;
  }

  snprintf(buf, sizeof(buf),
    "],\"last7Days\":[{\"date\":\"%s\",\"label\":\"Today\",\"present\":%d,\"late\":%d,\"absent\":%d}]}",
    todayDate, pCount, lCount, aCount
  );
  server.sendContent(buf);
  server.sendContent("");
}

// POST /api/status -> Teacher manual P / A / L circle override
void handlePostStatus() {
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"error\":\"Empty body\"}");
    return;
  }
  String body = server.arg("plain");
  String uid = extractJsonString(body, "uid");
  String status = extractJsonString(body, "status");
  String date = extractJsonString(body, "date");
  String timeStr = extractJsonString(body, "time");
  String cls = extractJsonString(body, "class");
  String subj = extractJsonString(body, "subject");
  String sec = extractJsonString(body, "section");

  int idx = findStudentIndex(uid.c_str());
  String name = (idx >= 0) ? String(students[idx].name) : extractJsonString(body, "name");
  if (cls.length() == 0 && idx >= 0) cls = String(students[idx].className);
  if (sec.length() == 0 && idx >= 0) sec = String(students[idx].section);

  upsertAttendanceCsvRow(uid, name, date, timeStr, status, cls, subj, sec);
  server.send(200, "application/json", "{\"ok\":true}");
}

// POST /api/session -> Start or Stop "Take Attendance" Session
// Closing the session marks remaining students in that class/section with no tap as Absent ('A')
void handlePostSession() {
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"error\":\"Empty body\"}");
    return;
  }
  String body = server.arg("plain");
  bool nextActive = (body.indexOf("\"active\":true") != -1) || (body.indexOf("\"active\": true") != -1);
  String date = extractJsonString(body, "date");
  String cls  = extractJsonString(body, "class");
  String subj = extractJsonString(body, "subject");
  String sec  = extractJsonString(body, "section");

  char todayDate[12], nowTime[10], dayShort[6];
  getCurrentDateTimePHT(todayDate, sizeof(todayDate), nowTime, sizeof(nowTime), dayShort, sizeof(dayShort));
  if (date.length() == 0) date = String(todayDate);

  currentSession.active = nextActive;
  strlcpy(currentSession.date, date.c_str(), sizeof(currentSession.date));
  strlcpy(currentSession.className, cls.c_str(), sizeof(currentSession.className));
  strlcpy(currentSession.subject, subj.c_str(), sizeof(currentSession.subject));
  strlcpy(currentSession.section, sec.c_str(), sizeof(currentSession.section));
  strlcpy(currentSession.startedAt, nowTime, sizeof(currentSession.startedAt));

  // If closing session, mark remaining unmarked students in this class/section as Absent ('A')
  if (!nextActive) {
    bool hasRecord[MAX_STUDENTS] = { false };
    File csv = SD_MMC.open("/attendance.csv", FILE_READ);
    if (csv) {
      while (csv.available()) {
        String line = csv.readStringUntil('\n');
        String cols[9];
        parseCsvLine(line, cols);
        if (cols[2] == date) {
          int idx = findStudentIndex(cols[0].c_str());
          if (idx >= 0) hasRecord[idx] = true;
        }
      }
      csv.close();
    }

    File appendCsv = SD_MMC.open("/attendance.csv", FILE_APPEND);
    if (appendCsv) {
      for (int i = 0; i < studentCount; i++) {
        if (cls.length() > 0 && !cls.equalsIgnoreCase(students[i].className)) continue;
        if (sec.length() > 0 && !sec.equalsIgnoreCase(students[i].section)) continue;
        if (!hasRecord[i]) {
          appendCsv.printf("%s,%s,%s,%s,,A,%s,%s,%s\n",
            students[i].uid, students[i].name, date.c_str(), nowTime,
            students[i].className, subj.c_str(), students[i].section
          );
        }
      }
      appendCsv.close();
    }
  }

  char resp[200];
  snprintf(resp, sizeof(resp),
    "{\"ok\":true,\"session\":{\"active\":%s,\"class\":\"%s\",\"subject\":\"%s\",\"section\":\"%s\"}}",
    currentSession.active ? "true" : "false",
    currentSession.className,
    currentSession.subject,
    currentSession.section
  );
  server.send(200, "application/json", resp);
}

// GET /photo?f=photo_20261116_080412.jpg (with strict path-traversal check)
void handlePhoto() {
  String f = server.arg("f");
  if (f.startsWith("/photos/")) f = f.substring(8);
  else if (f.startsWith("/")) f = f.substring(1);

  if (f.length() == 0 || f.indexOf('/') != -1 || f.indexOf('\\') != -1 ||
      f.indexOf("..") != -1 || !f.startsWith("photo_") || !f.endsWith(".jpg")) {
    server.send(400, "text/plain", "Bad filename");
    return;
  }

  File file = SD_MMC.open("/photos/" + f, FILE_READ);
  if (!file) {
    // Fallback to root for older photos stored before /photos/ folder
    file = SD_MMC.open("/" + f, FILE_READ);
  }
  if (!file) {
    server.send(404, "text/plain", "Photo not found");
    return;
  }
  server.streamFile(file, "image/jpeg");
  file.close();
}

// GET /export?date=&class=&subject=&section= -> Downloads filtered or full /attendance.csv
void handleDownloadCSV() {
  File file = SD_MMC.open("/attendance.csv", FILE_READ);
  if (!file) {
    server.send(404, "text/plain", "attendance.csv not found");
    return;
  }

  String qDate = server.arg("date");
  String qClass = server.arg("class");
  String qSubj = server.arg("subject");
  String qSec = server.arg("section");
  bool hasFilter = (qDate.length() > 0 || qClass.length() > 0 || qSubj.length() > 0 || qSec.length() > 0);

  // If no filter parameters were chosen, stream the entire file directly
  if (!hasFilter) {
    server.sendHeader("Content-Disposition", "attachment; filename=\"attendance.csv\"");
    server.streamFile(file, "text/csv");
    file.close();
    return;
  }

  // Build descriptive attachment filename
  String fname = "attendance";
  if (qSubj.length() > 0)  fname += "_" + qSubj;
  if (qSec.length() > 0)   fname += "_" + qSec;
  if (qDate.length() > 0)  fname += "_" + qDate;
  fname.replace(" ", "_");
  fname += ".csv";

  server.sendHeader("Content-Disposition", "attachment; filename=\"" + fname + "\"");
  server.setContentLength(CONTENT_LENGTH_UNKNOWN);
  server.send(200, "text/csv", "");
  server.sendContent("UID,Name,Date,Time,PhotoPath,Status,Class,Subject,Section\n");

  while (file.available()) {
    String line = file.readStringUntil('\n');
    line.trim();
    if (line.length() < 5 || line.startsWith("UID,")) continue;

    String cols[9];
    parseCsvLine(line, cols);

    // Fallback to student database for Class/Section if row is an older 5-column entry
    int sIdx = findStudentIndex(cols[0].c_str());
    String rowClass = cols[6].length() > 0 ? cols[6] : (sIdx >= 0 ? String(students[sIdx].className) : "");
    String rowSubj  = cols[7];
    String rowSec   = cols[8].length() > 0 ? cols[8] : (sIdx >= 0 ? String(students[sIdx].section) : "");

    if (qDate.length() > 0 && cols[2] != qDate) continue;
    if (qClass.length() > 0 && !rowClass.equalsIgnoreCase(qClass)) continue;
    if (qSubj.length() > 0 && rowSubj.length() > 0 && !rowSubj.equalsIgnoreCase(qSubj)) continue;
    if (qSec.length() > 0 && !rowSec.equalsIgnoreCase(qSec)) continue;

    String outRow = line + "\n";
    server.sendContent(outRow);
  }

  server.sendContent("");
  file.close();
}

// ============================================================================
// OV2640 CAMERA INITIALIZATION (QVGA 320x240 JPEG)
// ============================================================================
void initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size   = FRAMESIZE_QVGA; // 320x240 for fast capture & SD saving
  config.jpeg_quality = 12;
  config.fb_count     = 1;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[ERROR] Camera init failed with error 0x%x\n", err);
  }
}
