# Aer Chrome Extension

## Setup Instructions

### 1. Install Dependencies

The extension uses npm packages that need to be bundled. First, install dependencies:

npm install

### 2. Configure Environment

Copy the environment template:

cp .env.example .env

### 3. Configure Convex

The extension needs your Convex deployment URL. You can find this in:
- Your Convex dashboard
- The web app's environment variables
- The `.env` file in the main project

Update `background.js` with your Convex URL: