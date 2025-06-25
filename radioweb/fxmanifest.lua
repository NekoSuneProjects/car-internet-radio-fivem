fx_version 'cerulean'
game 'gta5'

author 'NekoSuneVR'
description 'Car Radio System for FiveM with dynamic radio stations'
version '1.0.0'

client_scripts {
    'config.lua',
    'client.lua'
}

server_scripts {
    'config.lua',
    'server.lua'
}

ui_page 'html/index.html'

files {
    'html/index.html',
    'html/style.css',
    'html/script.js'
}

dependencies {
    'xsound'
}

-- Enable HTTP requests
http_dispatch {
    allow {
        method = 'GET',
        path = '/radio/*'
    },
    allow {
        method = 'GET',
        path = '/radio'
    }
}