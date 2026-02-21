-- Server-side logic for radio system
local CUSTOM_FILE = 'custom_radios.json'
local customRadios = { nextId = 1, stations = {} }

local function isSoundcloud(url)
    return url and (string.find(url, 'soundcloud.com', 1, true) or string.find(url, 'sndcdn.com', 1, true))
end

local function urlEncode(str)
    return str and str:gsub("([^%w%-%_%.%~])", function(c) return string.format("%%%02X", string.byte(c)) end)
end

local function pickPlayableUrlForTrack(originalUrl, data)
    if not data or type(data) ~= 'table' then
        return nil
    end

    if data.url and data.url ~= '' then
        return data.url
    end

    local lists = {
        data.playable_formats,
        data.formats
    }

    local firstAny = nil
    local firstMp3 = nil
    local firstAudioOnly = nil

    for _, list in ipairs(lists) do
        if type(list) == 'table' then
            for _, f in ipairs(list) do
                if f and f.url and f.url ~= '' then
                    if not firstAny then
                        firstAny = f.url
                    end
                    if isSoundcloud(originalUrl) and f.format_id == 'http_mp3_1_0' then
                        return f.url
                    end
                    if not firstMp3 and (f.ext == 'mp3' or f.acodec == 'mp3') then
                        firstMp3 = f.url
                    end
                    if not firstAudioOnly and (f.vcodec == 'none') then
                        firstAudioOnly = f.url
                    end
                end
            end
        end
    end

    return firstMp3 or firstAudioOnly or firstAny
end

local function parseTrackInfoPayload(originalUrl, data)
    if not data or type(data) ~= 'table' then
        return nil, nil, nil, nil
    end

    local durationSeconds = tonumber(data.duration)
    local durationMs = nil
    if durationSeconds and durationSeconds > 0 then
        durationMs = math.floor(durationSeconds * 1000)
    end

    local durationString = nil
    if type(data.duration_string) == 'string' and data.duration_string ~= '' then
        durationString = data.duration_string
    end
    if not durationMs and durationString then
        local parts = {}
        for p in string.gmatch(durationString, '(%d+)') do
            table.insert(parts, tonumber(p) or 0)
        end
        if #parts == 2 then
            durationMs = ((parts[1] * 60) + parts[2]) * 1000
        elseif #parts == 3 then
            durationMs = ((parts[1] * 3600) + (parts[2] * 60) + parts[3]) * 1000
        end
    end

    local playUrl = pickPlayableUrlForTrack(originalUrl, data)

    local formats = nil
    if data.formats and type(data.formats) == 'table' then
        formats = {}
        for _, f in ipairs(data.formats) do
            table.insert(formats, {
                format_id = f.format_id,
                url = f.url,
                abr = f.abr,
                ext = f.ext,
                acodec = f.acodec,
                vcodec = f.vcodec
            })
        end
    end

    return durationMs, durationString, playUrl, formats
end

local function buildInfoEndpoints(encodedUrl)
    local endpoints = {}
    local seen = {}

    local function addEndpoint(base)
        if not base or base == '' then
            return
        end
        local endpoint = base .. '?url=' .. encodedUrl
        if not seen[endpoint] then
            seen[endpoint] = true
            table.insert(endpoints, endpoint)
        end
    end

    if Config and type(Config.CustomStreamNodes) == 'table' then
        for _, node in ipairs(Config.CustomStreamNodes) do
            if node and node ~= '' then
                addEndpoint(node .. '/info')
            end
        end
    end

    return endpoints
end

local function fetchTrackDuration(url, cb)
    if not url or url == '' then
        cb(nil, nil, nil, nil)
        return
    end
    local encoded = urlEncode(url)
    if not encoded then
        cb(nil, nil, nil, nil)
        return
    end
    local endpoints = buildInfoEndpoints(encoded)
    local function tryEndpoint(index)
        if not endpoints[index] then
            cb(nil, nil, nil, nil)
            return
        end

        PerformHttpRequest(endpoints[index], function(status, response, headers)
            if status == 200 and response then
                local ok, data = pcall(json.decode, response)
                if ok and data then
                    local durationMs, durationString, playUrl, formats = parseTrackInfoPayload(url, data)
                    cb(durationMs, durationString, playUrl, formats)
                    return
                end
            end
            tryEndpoint(index + 1)
        end, 'GET', '', { ['Content-Type'] = 'application/json' })
    end

    tryEndpoint(1)
end

local function loadCustomRadios()
    local data = LoadResourceFile(GetCurrentResourceName(), CUSTOM_FILE)
    if data then
        local decoded = json.decode(data)
        if decoded and decoded.stations and decoded.nextId then
            customRadios = decoded
        end
    else
        -- initialize empty file if missing
        saveCustomRadios()
    end
end

local function saveCustomRadios()
    SaveResourceFile(GetCurrentResourceName(), CUSTOM_FILE, json.encode(customRadios), -1)
end

local function getIdentifier(src)
    for _, id in ipairs(GetPlayerIdentifiers(src)) do
        if string.find(id, 'license:') == 1 then
            return id
        end
    end
    return GetPlayerIdentifier(src, 0)
end

local function sendCustomRadios(target)
    local identifier = getIdentifier(target)
    local list = {}
    for _, station in ipairs(customRadios.stations) do
        if station.isPublic or station.owner == identifier then
            local copy = {
                id = station.id,
                owner = station.owner,
                ownerName = station.ownerName,
                name = station.name,
                title = station.title,
                isPublic = station.isPublic,
                tracks = station.tracks,
                resolvedUrl = station.resolvedUrl,
                editable = station.owner == identifier
            }
            table.insert(list, copy)
        end
    end
    TriggerClientEvent('radioweb:receiveCustomRadios', target, list)
end

loadCustomRadios()

RegisterServerEvent('radioweb:selectRadio')
AddEventHandler('radioweb:selectRadio', function(vehicleNetId, radioIndex)
    TriggerClientEvent('radioweb:syncRadio', -1, vehicleNetId, radioIndex)
end)

-- Fetch radio stations from backend
RegisterServerEvent('radioweb:fetchRadios')
AddEventHandler('radioweb:fetchRadios', function()
    local source = source
    local endpoints = {
        Config.Username ~= '' and (Config.API_URL .. '/' .. Config.Username) or nil,
        Config.API_URL,
        Config.API_URL:match('(.*/radio)$') and (Config.API_URL:match('(.*/radio)$') .. 's') or nil
    }
    local function tryEndpoint(index)
        if not endpoints[index] then
            TriggerClientEvent('radioweb:receiveRadios', source, nil, 'No valid endpoints')
            return
        end
        PerformHttpRequest(endpoints[index], function(status, response, headers)
            if status == 200 then
                local data = json.decode(response)
                TriggerClientEvent('radioweb:receiveRadios', source, data, nil)
            else
                tryEndpoint(index + 1)
            end
        end, 'GET', '', { ['Content-Type'] = 'application/json', ['Authorization'] = 'Bearer ' .. GetConvar('RADIO_API_TOKEN', '') })
    end
    tryEndpoint(1)
end)

-- Custom URL playback (YouTube / SoundCloud / direct)
RegisterServerEvent('radioweb:playCustomRadio')
AddEventHandler('radioweb:playCustomRadio', function(vehicleNetId, url, title)
    TriggerClientEvent('radioweb:syncCustomRadio', -1, vehicleNetId, url, title, nil)
end)

-- Request custom radios
RegisterServerEvent('radioweb:requestCustomRadios')
AddEventHandler('radioweb:requestCustomRadios', function()
    local src = source
    sendCustomRadios(src)
end)

-- Create custom station
RegisterServerEvent('radioweb:createCustomRadio')
AddEventHandler('radioweb:createCustomRadio', function(url, title, isPublic, tracks, stationName)
    local src = source
    local identifier = getIdentifier(src)
    local trackList = tracks
    if not trackList or #trackList == 0 then
        trackList = {}
    end
    local id = customRadios.nextId
    customRadios.nextId = customRadios.nextId + 1
    -- Backwards compat: create with single track, later we support playlists
    local station = {
        id = id,
        owner = identifier,
        ownerName = GetPlayerName(src) or 'Unknown',
        name = stationName or ('Station ' .. id),
        isPublic = isPublic and true or false,
        tracks = trackList
    }
    table.insert(customRadios.stations, station)
    saveCustomRadios()

    -- Send to owner
    sendCustomRadios(src)
    -- Broadcast refreshed lists respecting visibility
    for _, playerId in ipairs(GetPlayers()) do
        sendCustomRadios(playerId)
    end
end)

-- Add track to existing station
RegisterServerEvent('radioweb:addTrackToStation')
AddEventHandler('radioweb:addTrackToStation', function(stationId, title, url)
    local src = source
    local identifier = getIdentifier(src)
    if not stationId or not url or url == '' or not title or title == '' then
        return
    end
    fetchTrackDuration(url, function(durationMs, durationString, playUrl)
        for _, station in ipairs(customRadios.stations) do
            if station.id == stationId and station.owner == identifier then
                table.insert(station.tracks, {
                    title = title,
                    url = url,
                    duration = durationMs,
                    duration_string = durationString,
                    resolvedUrl = playUrl
                })
                saveCustomRadios()
                break
            end
        end
        sendCustomRadios(src)
        for _, playerId in ipairs(GetPlayers()) do
            sendCustomRadios(playerId)
        end
    end)
end)

-- Update track in existing station
RegisterServerEvent('radioweb:updateTrackInStation')
AddEventHandler('radioweb:updateTrackInStation', function(stationId, index, title, url)
    local src = source
    local identifier = getIdentifier(src)
    if not stationId or not index or not title or title == '' or not url or url == '' then
        return
    end
    fetchTrackDuration(url, function(durationMs, durationString, playUrl)
        for _, station in ipairs(customRadios.stations) do
            if station.id == stationId and station.owner == identifier and station.tracks and station.tracks[index] then
                station.tracks[index] = {
                    title = title,
                    url = url,
                    duration = durationMs,
                    duration_string = durationString,
                    resolvedUrl = playUrl
                }
                saveCustomRadios()
                break
            end
        end
        sendCustomRadios(src)
        for _, playerId in ipairs(GetPlayers()) do
            sendCustomRadios(playerId)
        end
    end)
end)

-- Remove track from station
RegisterServerEvent('radioweb:removeTrackFromStation')
AddEventHandler('radioweb:removeTrackFromStation', function(stationId, index)
    local src = source
    local identifier = getIdentifier(src)
    if not stationId or not index then
        return
    end
    for _, station in ipairs(customRadios.stations) do
        if station.id == stationId and station.owner == identifier and station.tracks and station.tracks[index] then
            table.remove(station.tracks, index)
            saveCustomRadios()
            break
        end
    end
    sendCustomRadios(src)
    for _, playerId in ipairs(GetPlayers()) do
        sendCustomRadios(playerId)
    end
end)

-- Fetch track info (duration) from external API
RegisterServerEvent('radioweb:requestTrackInfo')
AddEventHandler('radioweb:requestTrackInfo', function(url)
    local src = source
    if not url or url == '' then
        TriggerClientEvent('radioweb:receiveTrackInfo', src, url, nil, nil, nil, nil)
        return
    end
    fetchTrackDuration(url, function(durationMs, durationString, playUrl, formats)
        for _, station in ipairs(customRadios.stations) do
            if station.tracks then
                for _, track in ipairs(station.tracks) do
                    if track.url == url then
                        track.duration = durationMs
                        track.duration_string = durationString
                        if playUrl then
                            track.resolvedUrl = playUrl
                        end
                    end
                end
            end
        end
        saveCustomRadios()
        TriggerClientEvent('radioweb:receiveTrackInfo', src, url, durationMs, durationString, playUrl, formats)
    end)
end)

-- Delete custom station
RegisterServerEvent('radioweb:deleteCustomRadio')
AddEventHandler('radioweb:deleteCustomRadio', function(id)
    local src = source
    local identifier = getIdentifier(src)
    local removedPublic = false

    for idx = #customRadios.stations, 1, -1 do
        local station = customRadios.stations[idx]
        if station.id == id and station.owner == identifier then
            removedPublic = station.isPublic
            table.remove(customRadios.stations, idx)
            break
        end
    end
    saveCustomRadios()
    sendCustomRadios(src)
    for _, playerId in ipairs(GetPlayers()) do
        sendCustomRadios(playerId)
    end
end)

-- Play custom station by id (for dropdown)
RegisterServerEvent('radioweb:playCustomStation')
AddEventHandler('radioweb:playCustomStation', function(vehicleNetId, id)
    for _, station in ipairs(customRadios.stations) do
        if station.id == id then
            TriggerClientEvent('radioweb:syncCustomStation', -1, vehicleNetId, station)
            break
        end
    end
end)

-- Sync playlist index to passengers
RegisterServerEvent('radioweb:syncPlaylistIndex')
AddEventHandler('radioweb:syncPlaylistIndex', function(vehicleNetId, stationId, index)
    for _, station in ipairs(customRadios.stations) do
        if station.id == stationId then
            TriggerClientEvent('radioweb:syncCustomStationIndex', -1, vehicleNetId, stationId, index)
            break
        end
    end
end)
