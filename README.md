# FiveM Car Radio System

A dynamic car radio system for FiveM servers with a secure Node.js backend, PostgreSQL database, and a React-based admin panel. Allows players to select and listen to radio stations in vehicles, with administrators managing radio stations and user accounts via a web interface.

## Features
- **Dynamic Radio Stations**: Add, edit, or remove radio stations via a secure admin panel.
- **Secure Authentication**: JWT-based authentication with bcrypt password hashing, rate limiting, and account lockout for failed login attempts.
- **Auto-Generated Admin Account**: On first launch, creates a default admin account with a random temporary password (logged to console).
- **Empty Radio Database**: Radio stations database starts empty; stations are added manually via the admin panel.
- **JWT Secret Management**: Automatically generates and saves a secure JWT secret to `.env` if not provided.
- **FiveM Integration**: Seamless integration with FiveM using `xsound` for in-game audio streaming.
- **Blacklisted Vehicles**: Configurable vehicle blacklist (e.g., police cars) to prevent radio use.
- **Now Playing API**: Supports fetching current song data from radio station APIs (optional).
- **Responsive UI**: Admin panel built with React and Tailwind CSS; in-game UI with configurable fade-out.

## Requirements
- **Node.js**: v16 or higher
- **PostgreSQL**: v12 or higher
- **FiveM Server**: With `xsound` resource installed
- **Git**: For cloning the repository
- **NPM**: For installing dependencies

## File Structure
```
car_radio_system/
├── backend/
│   ├── server.js           # Node.js backend API
│   ├── package.json        # Backend dependencies
│   ├── .env               # Environment variables (auto-generated if missing)
│   ├── db.sql             # Database creation script
│   └── admin/             # Admin panel files
│       ├── index.html
│       ├── script.js
│       └── style.css
└── fivem_resource/
    ├── fxmanifest.lua      # FiveM resource manifest
    ├── config.lua          # Configuration settings
    ├── client.lua          # Client-side logic
    ├── server.lua          # Server-side logic
    └── html/              # In-game UI
        ├── index.html
        ├── style.css
        └── script.js
```

## Setup Instructions

### 1. Clone the Repository
```bash
git clone --recurse-submodules https://github.com/NekoSuneProjects/car_radio_system.git
cd car_radio_system
```

### 2. Set Up the Backend
1. Navigate to the `backend` directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the `backend` directory with the following (or it will be auto-generated):
   ```plaintext
   PORT=3000
   DATABASE_URL=postgres://your_username:your_password@localhost:5432/car_radio_db
   ```
   - Replace `your_username` and `your_password` with your PostgreSQL credentials.
   - Optionally, add `JWT_SECRET=your_secure_jwt_secret_here` (if omitted, a secure JWT secret will be auto-generated and saved to `.env` on first launch).
4. Create the PostgreSQL database:
   - Run the `db.sql` script in your PostgreSQL client:
     ```bash
     psql -U your_username -f db.sql
     ```
5. Start the backend:
   ```bash
   npm start
   ```
   - On first launch, the server will create a default admin account (`username: admin`, random temporary password) and log the credentials to the console. Log in at `http://localhost:3000/admin` to change the password immediately.

### 3. Set Up the FiveM Resource
1. Copy the `fivem_resource` folder to your FiveM server's `resources` directory.
2. Ensure the `xsound` resource is installed on your FiveM server.
3. Add the resource to your `server.cfg`:
   ```plaintext
   ensure rcore_car_radio
   ```
4. Configure `fivem_resource/config.lua` if needed:
   - `Config.API_URL`: Set to your backend URL (default: `http://localhost:3000`).
   - `Config.BlacklistedVehicles`: List of vehicle models where the radio is disabled.
   - `Config.UIFadeTime`: UI fade-out time in milliseconds.
   - `Config.UIKey`: Key to open the radio UI (default: E key, code 38).

### 4. Access the Admin Panel
- Open `http://localhost:3000/admin` in your browser.
- Log in with the default admin credentials (check console for temporary password).
- Change the password immediately upon first login.
- Use the admin panel to add, edit, or delete radio stations and manage user accounts.

## Usage
- **In-Game**:
  - Enter a non-blacklisted vehicle.
  - Press the configured key (default: E) to open the radio UI.
  - Select a radio station or turn off the radio.
  - Current song information (if available) displays in the UI.
- **Admin Panel**:
  - Log in to manage radio stations (name, stream URL, now-playing API, enabled status).
  - Manage users (add, edit, delete, enable/disable, force password change).
  - Default admin account cannot be deleted or modified by non-admin users.

## Security Features
- **JWT Authentication**: Tokens expire after 7 days; invalid tokens are rejected.
- **Password Security**: Passwords are hashed with bcrypt; minimum length of 8 characters.
- **Rate Limiting**: Limits login attempts to 5 per 15 minutes.
- **Account Lockout**: Locks accounts for 15 minutes after 5 failed login attempts.
- **Helmet Middleware**: Adds secure HTTP headers.
- **CORS**: Restricted to the backend's origin (`http://localhost:3000` by default).

## Notes
- Ensure the PostgreSQL database is running and accessible before starting the backend.
- The radio stations table is empty on first launch; add stations via the admin panel.
- The `.env` file is auto-updated with a secure `JWT_SECRET` if not provided.
- For production, secure the `.env` file and use a strong database password.
- Update `Config.API_URL` in `fivem_resource/config.lua` if hosting the backend on a different server.

## Troubleshooting
- **Backend fails to start**: Check PostgreSQL credentials in `.env` and ensure the database is running.
- **No radio stations in-game**: Verify the backend is running and accessible; add stations via the admin panel.
- **Admin panel access denied**: Check console for temporary admin password or reset via database.
- **JWT errors**: Ensure the `.env` file has a valid `JWT_SECRET` or let the system generate one.

## Contributing
Contributions are welcome! Please submit a pull request or open an issue on GitHub.

## License
This project is licensed under the MIT License.

<!-- GitAds-Verify: UZT9PUSPNUU1YSAZI29YNZYMCG2HC7DO -->

## GitAds Sponsored
[![Sponsored by GitAds](https://gitads.dev/v1/ad-serve?source=nekosuneprojects/car-internet-radio-fivem@github)](https://gitads.dev/v1/ad-track?source=nekosuneprojects/car-internet-radio-fivem@github)

