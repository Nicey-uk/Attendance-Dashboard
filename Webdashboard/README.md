# WDC Attendance — ESP32-CAM RFID & Photo Verification Web Dashboard

Complete SD-card web dashboard and updated `WebServer.h` firmware for the **AI-Thinker ESP32-CAM + RC522 RFID + Active Buzzer** attendance system.

---

## 1. MicroSD Card Folder Structure (FAT32)

Copy the following folders and files directly to the **root (`/`)** of your FAT32-formatted MicroSD card:

```text
/ (MicroSD Root)
├── www/
│   ├── index.html          # Single-page app (#dashboard, #attendance, #schedule)
│   ├── app.css             # WDC UI stylesheet (Indigo rail + responsive cards)
│   └── app.js              # Vanilla JS frontend (5s auto-refresh, SVG chart, CRUD)
├── photos/                 # Captured QVGA JPEGs (/photos/photo_YYYYMMDD_HHMMSS.jpg)
├── students.json           # Registered student UID, Name, Class, Section
├── schedule.json           # Weekly class timetable & Late grace period config
└── attendance.csv          # Attendance log (UID,Name,Date,Time,PhotoPath,Status,Class,Subject,Section)
```

> **Note:** Keep `main_attendance_system/main_attendance_system.ino` on your PC/phone for flashing via Arduino IDE or ArduinoDroid.

---

## 2. Setup & Testing Steps

1. **Format & Populate MicroSD Card:**
   - Format a 16GB/32GB MicroSD card as **FAT32**.
   - Copy `www/`, `photos/`, `students.json`, `schedule.json`, and `attendance.csv` to the root of the MicroSD card, then insert it into the ESP32-CAM slot.
2. **Flash the Firmware:**
   - Open `main_attendance_system/main_attendance_system.ino` in **Arduino IDE**.
   - Update `ssid` and `password` at the top of the sketch with your mobile hotspot credentials.
   - Select **Board:** `AI Thinker ESP32-CAM` and **Partition Scheme:** `Huge APP (3MB No OTA/1MB SPIFFS)`.
   - Upload the sketch and open Serial Monitor at **115200 baud** to see the assigned IP address (`http://<ESP32-IP>/`).
3. **Open the Dashboard:**
   - On your phone or laptop connected to the same hotspot, open `http://<ESP32-IP>/`.
   - Navigate between **Dashboard**, **Attendance**, and **Class Schedule** in the left sidebar.
4. **Test Live RFID Taps & Features:**
   - **Class Schedule (`#schedule`):** Add or edit classes (`Mon–Sat`, `7:00 AM–6:00 PM`). The active class is highlighted automatically using NTP Philippine Time (`GMT+8`).
   - **Take Attendance (`#attendance`):** Select Class, Subject, and Section, then click **Take Attendance** to open a live session (`Session Open` pulsing badge).
   - **Tap an RFID Card:** The ESP32-CAM captures a QVGA JPEG into `/photos/`, triggers a 100ms beep on GPIO 2, ignores duplicate taps from the same card within 60 seconds, and marks the student **Present (`P`, green)** or **Late (`L`, orange)** if tapped after `start + grace` (15 min default).
   - **Close Session / Manual Override:** Click **Session Open (End)** to close the session and mark remaining students **Absent (`A`, red)**, or click any **P / A / L** circle to manually override and save to `/attendance.csv`.
   - **View Photo & Export CSV:** Click any student's circular avatar to inspect the captured QVGA photo and timestamp modal, or click **Export CSV** (`/export`) to download `attendance.csv`.

    - **Add / Edit Students (Web UI):** Click **+ Add Student** on the Attendance page to register a new RFID card UID, Name, Class, and Section. It immediately saves to /students.json on the MicroSD card without editing code or removing the SD card. Click **Use Last Tap** to automatically paste the UID of the card you just tapped!