Config = {}

-- JSON API endpoint
Config.API_URL = 'https://fivem-radio.nekosunevr.co.uk/radio' -- Base API URL (e.g., https://fivem-radio.nekosunevr.co.uk/radio)
Config.Username = '' -- Optional: Username to append (e.g., 'nekosunevr' for /radio/nekosunevr; empty for global radios)

-- Blacklisted vehicle models (police cars)
Config.BlacklistedVehicles = {
    'police',
    'police2',
    'police3',
    'police4',
    'policeb',
    'policet',
    'sheriff',
    'sheriff2'
}

-- UI settings
Config.UIFadeTime = 5000 -- Time in ms before UI fades out
Config.UIKey = 38 -- Key to open radio (default: E)