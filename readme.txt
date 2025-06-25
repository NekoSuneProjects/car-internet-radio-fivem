# Changes Made
1. **Synced Radio Playback**:
   - Added server-side event `rcore_car_radio:selectRadio` to broadcast radio changes.
   - Client event `rcore_car_radio:syncRadio` syncs radio state for all players in the same vehicle using vehicle network ID.
   - `xsound:PlayUrlPos` uses vehicle-specific audio IDs (`car_radio_<vehicleNetId>`) to ensure synced playback.
2. **Vehicle Tracking**:
   - Added `currentVehicle` to track the player's vehicle.
   - Used `NetworkGetNetworkIdFromEntity` to identify vehicles across clients.
3. **UI and Logic**:
   - UI remains unchanged but now triggers synced radio changes via server events.
   - Radio selection is broadcast to all players in the vehicle, ensuring everyone hears the same station.

# Installation Instructions
1. Ensure your FiveM server is running artifact 4752 or newer.
2. Install the `xsound` dependency.
3. Place the script folder in your `resources` directory.
4. Add `ensure rcore_car_radio` to your `server.cfg`.
5. Configure `Config.API_URL` with your JSON API endpoint (format: `{ "song": "Current Song Title" }`).
6. Update `Config.Radios` with your radio stations and URLs.
7. Update `Config.BlacklistedVehicles` with police car model names.

# Usage
- Enter a non-police vehicle as the radio.
- Press `E` (configurable in config) to open the radio UI.
- Select a radio station or turn off the radio.
- All players in the vehicle radio will hear the same radio station.
- UI shows the current song title from the API, updating when the radio is turned on or the song changes (checked every 30 seconds).
- The UI is disabled in police vehicles.

# Notes
- The JSON API should return `{ "song": "Current Song Title"}` for each radio URL.
- The UI is minimal, only appears when toggled or on song change/radio, and fades out after 5 seconds (configurable).
- Synchronization uses `xsound` for 3D audio, with sound tied to the vehicle's position.
- The radio state (station or off) is synced for all occupants of the vehicle.