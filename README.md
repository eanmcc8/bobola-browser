# Puppeteer Remote Browser Server - Usage Guide

## Overview
This project provides a remote control server for Puppeteer, enabling automated browser management with features like tab control, viewport streaming, interaction recording, and more. It includes a simple web interface, APIs, and interaction saving/loading.

---

## Setup Instructions

1. Clone or copy the server code into your project directory.
2. Install dependencies:
   npm install
3. Start the server:
   npm start
4. Access the web interface at:
   http://localhost:8080/

---

## Authentication
- Default username: admin
- Default password: password

Use these credentials when prompted.

---

## Main Features & Usage

### 1. Web Interface
- Open your browser to http://localhost:8080/
- Use the UI to:
  - Create new tabs
  - Switch between existing tabs
  - Close tabs
  - View the list of open tabs

### 2. Viewport Streaming
- The /viewport.mjpeg endpoint streams the current tab viewport as MJPEG.
- To view the live browser window, open:
  http://localhost:8080/viewport.mjpeg

### 3. Resize Viewport
- Click on the overlay images or trigger the /set-viewport-dimensions/width/:width/height/:height/set.png URL.
- You can resize the viewport by specifying desired width and height.

### 4. Sending Interactions
- Use the web interface forms or POST data to /carpediem.
- Interaction types include:
  - Clicks
  - Scrolls
  - Typing

### 5. Save & Load Interactions
- Interactions are automatically saved in interactions.json.
- To export interactions:
  - Visit /interactions/export and download the JSON.
- To import interactions:
  - POST a JSON payload to /interactions/import.

### 6. Managing Tabs
- Create new tabs: Use the UI button.
- Switch tabs: Select from the list.
- Close tabs: Use the close button next to each tab.

---

## Advanced Usage & Customization

- Change the server port or start URL by editing the code.
- Customize authentication by modifying the server code.

---

## Troubleshooting
- Ensure Node.js is installed.
- Check console logs for errors.
- Verify dependencies installed correctly with npm install.
- Restart server after making changes.

---

## License
This project is licensed under the MIT License.

---

## Notes
- All interactions are logged for replay or analysis.
- Use the web interface for ease; API endpoints are for automation or integration.

---

**End of Guide**
