# SLTMobitel EasyApply Backend

This is the backend API service for the **SLTMobitel EasyApply** customer application portal, built using **Node.js**, **Express**, and **MongoDB**.

This service implements **Module 01: Authentication & User Management**.

---

## ❖ Prerequisites

Make sure you have the following installed on your machine:
* **Node.js** (v20 or higher recommended)
* **MongoDB** (Running locally, in Docker, or an active MongoDB Atlas cluster)

---

## ❖ Setup Instructions

### 1. Install Dependencies
Run the following command inside the `Easy-Apply-Backend` directory:
```bash
npm install
```

### 2. Configure Environment Variables
Create a `.env` file in the root of `Easy-Apply-Backend` (use `.env.example` as a template):
```env
PORT=5000
NODE_ENV=development
MONGO_URI=mongodb://127.0.0.1:27017/easyapply
JWT_ACCESS_SECRET=your_access_secret_key_here
JWT_REFRESH_SECRET=your_refresh_secret_key_here
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
```

### 3. Run MongoDB in Docker (Optional)
If you have Docker installed and want to run a local database instance:
```bash
docker run -d -p 27017:27017 --name easyapply-db mongo:latest
```

### 4. Start Server
To start the server in development mode (with auto-reload on save):
```bash
npm run dev
```
The server will start running on `http://localhost:5000`.

