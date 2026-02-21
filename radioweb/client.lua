local xsound = exports.xsound
local isInVehicle = false
local currentRadio = nil
local currentSong = nil
local currentRadioType = nil -- 'global' or 'custom'
local uiVisible = false
local currentVehicle = nil
local radioStations = {}
local customStations = {}
local activeRadios = {} -- Track active radio instances
local nuiHasFocus = false -- Track if we've intentionally grabbed focus
local customSource = nil -- Track custom URL playback
local playlistState = {} -- vehicleNetId -> { stationId, tracks, index }
local durationCache = {}
local urlCache = {}
local pendingPlays = {}
local userVolume = 1.0

local function urlEncode(value)
    if not value then return '' end
    return (value:gsub('\n', '\r\n'):gsub('([^%w%-_%.~])', function(c)
        return string.format('%%%02X', string.byte(c))
    end))
end

local function buildCustomProxyUrls(rawUrl)
    local urls = {}
    if not rawUrl or rawUrl == '' then
        return urls
    end
    local encoded = urlEncode(rawUrl)
    local nodes = Config.CustomStreamNodes or {
        'https://dl.nekosunevr.co.uk',
        'https://dl.ballisticok.xyz'
    }
    for _, node in ipairs(nodes) do
        if node and node ~= '' then
            table.insert(urls, node .. '/api/stream?url=' .. encoded .. '&format=mp3')
        end
    end
    return urls
end

local function asNumber(val)
    if type(val) == 'number' then
        return val
    end
    return nil
end

local function durationStringToMs(value)
    if type(value) ~= 'string' or value == '' then
        return nil
    end
    local parts = {}
    for p in string.gmatch(value, '(%d+)') do
        table.insert(parts, tonumber(p) or 0)
    end
    if #parts == 2 then
        return ((parts[1] * 60) + parts[2]) * 1000
    end
    if #parts == 3 then
        return ((parts[1] * 3600) + (parts[2] * 60) + parts[3]) * 1000
    end
    return nil
end

local function isSoundcloudUrl(url)
    if not url then return false end
    return string.find(url, 'soundcloud.com', 1, true) or string.find(url, 'sndcdn.com', 1, true)
end

local function baseVolume(inVehicle)
    return inVehicle and 0.5 or 0.1
end

local function getVolume(inVehicle)
    return baseVolume(inVehicle) * userVolume
end

local function getStationName(stationId)
    if not stationId then return 'Radio' end
    for _, st in ipairs(customStations or {}) do
        if st.id == stationId then
            return st.name or st.title or 'Custom Station'
        end
    end
    return 'Custom Station'
end

local function sendNowPlaying(title, station)
    SendNUIMessage({
        type = 'nowPlaying',
        title = title or 'Unknown',
        station = station or 'Radio'
    })
end

-- Check if vehicle is blacklisted
local function IsVehicleBlacklisted(vehicle)
    local model = GetEntityModel(vehicle)
    local modelName = GetDisplayNameFromVehicleModel(model):lower()
    for _, blacklisted in ipairs(Config.BlacklistedVehicles) do
        if modelName == blacklisted then
            return true
        end
    end
    return false
end

-- Hide UI
local function HideUI()
    SendNUIMessage({ type = 'hide' })
    uiVisible = false
    nuiHasFocus = false
    SetNuiFocus(false, false) -- Disable mouse cursor and focus
end

-- Show UI
local function ShowUI(useFocus)
    if useFocus == nil then
        useFocus = false
    end
    SendNUIMessage({
        type = 'show',
        radios = radioStations,
        customRadios = customStations,
        currentRadio = (currentRadioType == 'global' and currentRadio) and ('g:' .. tostring(currentRadio)) or (currentRadioType == 'custom' and currentRadio) or nil,
        currentSong = currentSong or 'Unknown',
        volume = math.floor(userVolume * 100)
    })
    uiVisible = true
    if useFocus then
        nuiHasFocus = true
        SetNuiFocus(true, true) -- Enable mouse cursor and focus when explicitly requested
    elseif not nuiHasFocus then
        SetNuiFocus(false, false) -- Avoid stealing controls for passive popups
    end
end

-- Fetch radio stations (try /radio/username, /radio, /radios)
local function FetchRadioStations()
    if PerformHttpRequest then
        local endpoints = {
            Config.Username ~= '' and (Config.API_URL .. '/' .. Config.Username) or nil,
            Config.API_URL,
            Config.API_URL:match('(.*/radio)$') and (Config.API_URL:match('(.*/radio)$') .. 's') or nil
        }
        local function tryEndpoint(index)
            if not endpoints[index] then
                TriggerServerEvent('radioweb:fetchRadios')
                return
            end
            PerformHttpRequest(endpoints[index], function(status, response, headers)
                if status == 200 then
                    local data = json.decode(response)
                    if data then
                        radioStations = data
                        if currentRadioType == 'global' and currentRadio and radioStations[currentRadio] and radioStations[currentRadio].song ~= currentSong then
                            currentSong = radioStations[currentRadio].song
                        end
                    else
                        print('FetchRadioStations: Invalid JSON response')
                    end
                else
                    tryEndpoint(index + 1)
                end
            end, 'GET', '', { ['Content-Type'] = 'application/json', ['Authorization'] = 'Bearer ' .. GetConvar('RADIO_API_TOKEN', '') })
        end
        tryEndpoint(1)
    else
        TriggerServerEvent('radioweb:fetchRadios')
    end
end

-- Receive radio stations from server
RegisterNetEvent('radioweb:receiveRadios')
AddEventHandler('radioweb:receiveRadios', function(data, error)
    if error then
        print('Failed to fetch radio stations (server): ' .. error)
        return
    end
    if data then
        radioStations = data
        if currentRadioType == 'global' and currentRadio and radioStations[currentRadio] and radioStations[currentRadio].song ~= currentSong then
            currentSong = radioStations[currentRadio].song
        end
    else
        print('receiveRadios: No data received from server')
    end
end)

-- Receive custom radios
RegisterNetEvent('radioweb:receiveCustomRadios')
AddEventHandler('radioweb:receiveCustomRadios', function(data)
    customStations = data or {}
    if uiVisible then
        ShowUI(nuiHasFocus)
    end
end)

-- Play radio
local function PlayRadio(index, vehicleNetId)
    local radio = radioStations[index]
    if radio then
        currentRadio = index
        currentRadioType = 'global'
        currentSong = radio.song or 'Unknown'
        customSource = nil
        local vehicle = NetworkGetEntityFromNetworkId(vehicleNetId)
        if not DoesEntityExist(vehicle) then
            return
        end
        local playerPed = PlayerPedId()
        local coords = GetEntityCoords(vehicle)
        local volume = getVolume(IsPedInVehicle(playerPed, vehicle, false))
        local soundName = 'car_radio_' .. vehicleNetId
        xsound:PlayUrlPos(soundName, radio.url, volume, coords, true) -- Dynamic position
        xsound:setSoundDynamic(soundName, true) -- ADD THIS
        xsound:Distance(soundName, 20.0) -- Range for external audibility
        -- Wait for audio to start playing
        local startTime = GetGameTimer()
        local timeout = 5000 -- 5 seconds timeout
        while true do
            Citizen.Wait(100)
            local info = xsound:getInfo(soundName)
            if info and info.playing then
                break
            end
            if GetGameTimer() - startTime > timeout then
                return
            end
        end
        activeRadios[vehicleNetId] = true -- Track active radio
        sendNowPlaying(currentSong, radio.name or 'Global Station')
    else
        print('PlayRadio: Invalid radio index or no radio data')
    end
end

-- Stop radio
local function StopRadio(vehicleNetId)
    if currentRadio or customSource then
        local soundName = 'car_radio_' .. vehicleNetId
        xsound:Destroy(soundName)
        activeRadios[vehicleNetId] = nil -- Remove from active radios
        currentRadio = nil
        currentSong = nil
        customSource = nil
        currentRadioType = nil
        SendNUIMessage({ type = 'hideNowPlaying' })
        if uiVisible then
            HideUI()
        end
    end
end

-- Play custom URL (YouTube/SoundCloud/direct)
local function PlayCustomTrack(vehicleNetId, stationId, trackData, trackIndex, markState)
    if not trackData or not trackData.url or trackData.url == '' then
        return
    end

    local originalUrl = trackData.url
    local resolvedUrl = trackData.resolvedUrl or urlCache[originalUrl] or originalUrl
    if isSoundcloudUrl(originalUrl) and not trackData.resolvedUrl and not urlCache[originalUrl] then
        TriggerServerEvent('radioweb:requestTrackInfo', originalUrl)
        pendingPlays[originalUrl] = {
            vehicleNetId = vehicleNetId,
            stationId = stationId,
            trackData = trackData,
            trackIndex = trackIndex,
            markState = markState
        }
        return
    end

    local vehicle = NetworkGetEntityFromNetworkId(vehicleNetId)
    if not DoesEntityExist(vehicle) then
        return
    end

    local playerPed = PlayerPedId()
    local coords = GetEntityCoords(vehicle)
    local volume = getVolume(IsPedInVehicle(playerPed, vehicle, false))
    local soundName = 'car_radio_' .. vehicleNetId
    local playUrls = buildCustomProxyUrls(originalUrl)

    currentRadio = 'c:' .. tostring(stationId or -1)
    currentRadioType = 'custom'
    customSource = { url = originalUrl, playUrl = playUrls[1], title = trackData.title }
    currentSong = (trackData.title and trackData.title ~= '') and trackData.title or originalUrl

    local duration = trackData.duration or trackData.length or trackData.maxDuration
    if not duration then
        duration = durationStringToMs(trackData.duration_string)
    end
    if duration and duration < 1000 then
        duration = duration * 1000 -- assume seconds if very small
    end
    if not duration then
        duration = durationCache[originalUrl]
        if not duration then
            TriggerServerEvent('radioweb:requestTrackInfo', originalUrl)
        end
    end
    local fallbackDuration = 240000 -- 4 minutes fallback for streams without metadata
    duration = duration or fallbackDuration

    if markState then
        playlistState[vehicleNetId] = {
            stationId = stationId,
            index = trackIndex or 1,
            tracks = markState.tracks or playlistState[vehicleNetId] and playlistState[vehicleNetId].tracks or {},
            startedAt = GetGameTimer(),
            duration = duration,
            lastAdvance = 0
        }
    else
        local state = playlistState[vehicleNetId] or {}
        state.stationId = stationId
        state.index = trackIndex or state.index or 1
        state.startedAt = GetGameTimer()
        state.duration = duration
        state.lastAdvance = state.lastAdvance or 0
        state.tracks = state.tracks or {}
        playlistState[vehicleNetId] = state
    end

    local played = false
    local selectedPlayUrl = nil
    if #playUrls == 0 then
        playUrls = { resolvedUrl }
    end
    for _, playUrl in ipairs(playUrls) do
        xsound:PlayUrlPos(soundName, playUrl, volume, coords, true)
        xsound:setSoundDynamic(soundName, true)
        xsound:Distance(soundName, 20.0)

        local startTime = GetGameTimer()
        local timeout = 5000 -- 5 seconds timeout
        while true do
            Citizen.Wait(100)
            local info = xsound:getInfo(soundName)
            if info and info.playing then
                played = true
                selectedPlayUrl = playUrl
                break
            end
            if GetGameTimer() - startTime > timeout then
                xsound:Destroy(soundName)
                break
            end
        end
        if played then
            break
        end
    end
    if not played then
        return
    end
    customSource.playUrl = selectedPlayUrl
    pendingPlays[originalUrl] = nil

    activeRadios[vehicleNetId] = true
    sendNowPlaying(currentSong, getStationName(stationId))
end

-- Helper function to count table entries
local function tableLength(tbl)
    local count = 0
    for _ in pairs(tbl) do count = count + 1 end
    return count
end

-- Sync radio state
RegisterNetEvent('radioweb:syncRadio')
AddEventHandler('radioweb:syncRadio', function(vehicleNetId, radioIndex)
    local vehicle = NetworkGetEntityFromNetworkId(vehicleNetId)
    if DoesEntityExist(vehicle) then
        local playerPed = PlayerPedId()
        if radioIndex == 0 then
            StopRadio(vehicleNetId)
        else
            customSource = nil
            currentRadioType = 'global'
            PlayRadio(radioIndex, vehicleNetId)
        end
        -- Update volume for nearby players
        if not IsPedInVehicle(playerPed, vehicle, false) then
            xsound:setVolume('car_radio_' .. vehicleNetId, getVolume(false))
        end
    else
        print('SyncRadio: Vehicle does not exist for netId', vehicleNetId)
    end
end)

-- Sync custom URLs
RegisterNetEvent('radioweb:syncCustomRadio')
AddEventHandler('radioweb:syncCustomRadio', function(vehicleNetId, url, title, customId)
    local vehicle = NetworkGetEntityFromNetworkId(vehicleNetId)
    if DoesEntityExist(vehicle) then
        customSource = { url = url, title = title }
        currentRadioType = 'custom'
        PlayCustomTrack(vehicleNetId, customId, { url = url, title = title }, 1, { tracks = { { url = url, title = title } } })
        if not IsPedInVehicle(PlayerPedId(), vehicle, false) then
            xsound:setVolume('car_radio_' .. vehicleNetId, getVolume(false))
        end
    else
        print('SyncCustomRadio: Vehicle does not exist for netId', vehicleNetId)
    end
end)

-- Sync custom station with playlist
RegisterNetEvent('radioweb:syncCustomStation')
AddEventHandler('radioweb:syncCustomStation', function(vehicleNetId, station)
    local vehicle = NetworkGetEntityFromNetworkId(vehicleNetId)
    if not DoesEntityExist(vehicle) then
        print('SyncCustomStation: Vehicle does not exist for netId', vehicleNetId)
        return
    end
    if not station or not station.tracks or #station.tracks == 0 then
        print('SyncCustomStation: Invalid station data')
        return
    end
    playlistState[vehicleNetId] = { stationId = station.id, index = 1, tracks = station.tracks }
    PlayCustomTrack(vehicleNetId, station.id, station.tracks[1], 1, playlistState[vehicleNetId])
end)

RegisterNetEvent('radioweb:syncCustomStationIndex')
AddEventHandler('radioweb:syncCustomStationIndex', function(vehicleNetId, stationId, index)
    local state = playlistState[vehicleNetId]
    if state and state.stationId == stationId and state.tracks and #state.tracks > 0 then
        local safeIndex = index
        if safeIndex < 1 or safeIndex > #state.tracks then
            safeIndex = 1
        end
        state.index = safeIndex
        PlayCustomTrack(vehicleNetId, stationId, state.tracks[safeIndex], safeIndex, state)
    end
end)

-- Receive duration info
RegisterNetEvent('radioweb:receiveTrackInfo')
AddEventHandler('radioweb:receiveTrackInfo', function(url, durationMs, durationString, resolvedUrl, formats)
    if url and durationMs and durationMs > 0 then
        durationCache[url] = durationMs
        -- Update current playing state if matches
        for vehicleNetId, state in pairs(playlistState) do
            if state.tracks and state.index and state.tracks[state.index] and state.tracks[state.index].url == url then
                state.duration = durationMs
                state.startedAt = GetGameTimer()
            end
            if state.tracks then
                for _, track in ipairs(state.tracks) do
                    if track.url == url then
                        track.duration = durationMs
                        if durationString and durationString ~= '' then
                            track.duration_string = durationString
                        end
                        if resolvedUrl then
                            track.resolvedUrl = resolvedUrl
                        end
                    end
                end
            end
        end
    end
    if url and resolvedUrl and resolvedUrl ~= '' then
        urlCache[url] = resolvedUrl
        -- Update current playback source
        if customSource and customSource.url == url then
            if not customSource.playUrl or customSource.playUrl == '' then
                local proxyUrls = buildCustomProxyUrls(url)
                customSource.playUrl = proxyUrls[1]
            end
        end
    end

    -- Resume pending SoundCloud plays once we have a resolved URL
    if url and resolvedUrl and pendingPlays[url] then
        local pending = pendingPlays[url]
        pending.trackData.resolvedUrl = resolvedUrl
        PlayCustomTrack(pending.vehicleNetId, pending.stationId, pending.trackData, pending.trackIndex, pending.markState)
        pendingPlays[url] = nil
    end
end)

-- Register /radio command
RegisterCommand('radio', function(source, args, rawCommand)
    local playerPed = PlayerPedId()
    local vehicle = GetVehiclePedIsIn(playerPed, false)
    if vehicle ~= 0 and not IsVehicleBlacklisted(vehicle) then
        TriggerServerEvent('radioweb:requestCustomRadios')
        if not uiVisible then
            ShowUI(true)
        else
            HideUI()
        end
    else
        print('Radio command: Not in a valid vehicle')
    end
end, false)

-- Main thread
Citizen.CreateThread(function()
    FetchRadioStations() -- Load radio stations on client start
    while true do
        Citizen.Wait(0)
        local playerPed = PlayerPedId()
        local vehicle = GetVehiclePedIsIn(playerPed, false)
        
        if vehicle ~= 0 then
            if not isInVehicle and not IsVehicleBlacklisted(vehicle) then
                isInVehicle = true
                currentVehicle = vehicle
                SetVehRadioStation(vehicle, "OFF") -- Disable in-game radio
                SendNUIMessage({ type = 'enable' })
                TriggerServerEvent('radioweb:requestCustomRadios')
                local vehicleNetId = NetworkGetNetworkIdFromEntity(vehicle)
                if activeRadios[vehicleNetId] and xsound:getInfo('car_radio_' .. vehicleNetId) then
                    xsound:setVolume('car_radio_' .. vehicleNetId, getVolume(true))
                end
            else
                currentVehicle = vehicle
                local vehicleNetId = NetworkGetNetworkIdFromEntity(vehicle)
                if activeRadios[vehicleNetId] and xsound:getInfo('car_radio_' .. vehicleNetId) then
                    xsound:setVolume('car_radio_' .. vehicleNetId, getVolume(true))
                end
            end
            
            if isInVehicle and Config.EnableUIKey and IsControlJustPressed(0, Config.UIKey) then
                if not uiVisible then
                    ShowUI(true)
                else
                    HideUI()
                end
            end
        else
            if isInVehicle then
                local wasDriver = currentVehicle and GetPedInVehicleSeat(currentVehicle, -1) == PlayerPedId()
                if wasDriver then
                    StopRadio(currentVehicle and NetworkGetNetworkIdFromEntity(currentVehicle) or 0)
                else
                    local netId = currentVehicle and NetworkGetNetworkIdFromEntity(currentVehicle)
                    if netId and xsound:getInfo('car_radio_' .. netId) then
                        xsound:setVolume('car_radio_' .. netId, getVolume(false))
                    end
                end
                isInVehicle = false
                SendNUIMessage({ type = 'disable' })
                if uiVisible then
                    HideUI()
                end
                currentVehicle = nil
            end
        end
    end
end)

-- Only update radio position for the local player’s vehicle
Citizen.CreateThread(function()
    while true do
        Citizen.Wait(100) -- Every 30 seconds
        local playerPed = PlayerPedId()
        local vehicle = GetVehiclePedIsIn(playerPed, false)

        if vehicle ~= 0 and DoesEntityExist(vehicle) then
            local vehicleNetId = NetworkGetNetworkIdFromEntity(vehicle)
            if activeRadios[vehicleNetId] then
                local soundName = 'car_radio_' .. vehicleNetId
                local coords = GetEntityCoords(vehicle)
                local info = xsound:getInfo(soundName)

                if info and info.playing then
                    xsound:Position(soundName, coords)
                else
                    if currentRadioType == 'global' and currentRadio and radioStations[currentRadio] then
                        local volume = getVolume(IsPedInVehicle(PlayerPedId(), vehicle, false))
                        xsound:PlayUrlPos(soundName, radioStations[currentRadio].url, volume, coords, true)
                        xsound:Distance(soundName, 20.0)

                        local startTime = GetGameTimer()
                        while true do
                            Citizen.Wait(100)
                            local newInfo = xsound:getInfo(soundName)
                            if newInfo and newInfo.playing then
                                break
                            end
                            if GetGameTimer() - startTime > 5000 then
                                activeRadios[vehicleNetId] = nil
                                break
                            end
                        end
                    elseif currentRadioType == 'custom' and customSource then
                        local volume = getVolume(IsPedInVehicle(PlayerPedId(), vehicle, false))
                        local played = false
                        local proxyUrls = buildCustomProxyUrls(customSource.url)
                        local playUrls = {}
                        if customSource.playUrl and customSource.playUrl ~= '' then
                            table.insert(playUrls, customSource.playUrl)
                        end
                        for _, purl in ipairs(proxyUrls) do
                            if purl ~= customSource.playUrl then
                                table.insert(playUrls, purl)
                            end
                        end
                        if #playUrls == 0 then
                            table.insert(playUrls, urlCache[customSource.url] or customSource.url)
                        end

                        for _, playUrl in ipairs(playUrls) do
                            xsound:PlayUrlPos(soundName, playUrl, volume, coords, true)
                            xsound:Distance(soundName, 20.0)

                            local startTime = GetGameTimer()
                            while true do
                                Citizen.Wait(100)
                                local newInfo = xsound:getInfo(soundName)
                                if newInfo and newInfo.playing then
                                    customSource.playUrl = playUrl
                                    played = true
                                    break
                                end
                                if GetGameTimer() - startTime > 5000 then
                                    xsound:Destroy(soundName)
                                    break
                                end
                            end
                            if played then
                                break
                            end
                        end

                        if not played then
                            activeRadios[vehicleNetId] = nil
                        end
                    else
                        activeRadios[vehicleNetId] = nil
                    end
                end
            end
        end

        -- Playlist progression (driver handles advancing)
        if isInVehicle and currentVehicle and currentRadioType == 'custom' then
            local vehicleNetId = NetworkGetNetworkIdFromEntity(currentVehicle)
            local state = playlistState[vehicleNetId]
            if state and state.tracks and #state.tracks > 0 then
                local soundName = 'car_radio_' .. vehicleNetId
                local info = xsound:getInfo(soundName)
                local shouldAdvance = false

                if info then
                    local dur = asNumber(info.duration) or asNumber(info.length) or asNumber(info.maxDuration)
                    local pos = asNumber(info.time) or asNumber(info.position) or asNumber(info.seek)
                    if dur and dur < 1000 then dur = dur * 1000 end -- normalize seconds to ms
                    if pos and pos < 1000 then pos = pos * 1000 end
                    if not info.playing then
                        shouldAdvance = true
                    elseif dur and pos and dur > 0 and pos >= (dur - 1500) then
                        shouldAdvance = true
                    end
                else
                    shouldAdvance = true
                end

                -- Fallback: no metadata or stream stuck; use tracked duration timer
                if not shouldAdvance and state.duration and state.startedAt then
                    local durMs = asNumber(state.duration)
                    if durMs and durMs < 1000 then durMs = durMs * 1000 end
                    local elapsed = GetGameTimer() - state.startedAt
                    if durMs and durMs > 0 and elapsed >= (durMs - 1000) then
                        shouldAdvance = true
                    end
                end

                if shouldAdvance and GetPedInVehicleSeat(currentVehicle, -1) == PlayerPedId() then
                    local now = GetGameTimer()
                    state.lastAdvance = state.lastAdvance or 0
                    if now - state.lastAdvance > 1000 then -- debounce within 1s
                        state.lastAdvance = now
                        local nextIndex = state.index + 1
                        if nextIndex > #state.tracks then
                            nextIndex = 1
                        end
                        state.index = nextIndex
                        state.startedAt = GetGameTimer()
                        PlayCustomTrack(vehicleNetId, state.stationId, state.tracks[nextIndex], nextIndex, state)
                        TriggerServerEvent('radioweb:syncPlaylistIndex', vehicleNetId, state.stationId, nextIndex)
                    end
                end
            end
        end
    end
end)


-- NUI callback for radio selection
RegisterNUICallback('selectRadio', function(data, cb)
    local value = tostring(data.index)
    if not isInVehicle or not currentVehicle then
        print('selectRadio: Not in vehicle or no current vehicle')
        cb('ok')
        return
    end

    local vehicleNetId = NetworkGetNetworkIdFromEntity(currentVehicle)

    if value == '0' then
        TriggerServerEvent('radioweb:selectRadio', vehicleNetId, 0)
    elseif string.sub(value, 1, 2) == 'c:' then
        local customId = tonumber(string.sub(value, 3))
        if customId then
            TriggerServerEvent('radioweb:playCustomStation', vehicleNetId, customId)
        end
    elseif string.sub(value, 1, 2) == 'g:' then
        local index = tonumber(string.sub(value, 3))
        if index then
            TriggerServerEvent('radioweb:selectRadio', vehicleNetId, index)
        end
    else
        local index = tonumber(value)
        if index then
            TriggerServerEvent('radioweb:selectRadio', vehicleNetId, index)
        end
    end
    cb('ok')
end)

-- NUI callback for custom URL
RegisterNUICallback('playCustom', function(data, cb)
    local url = tostring(data.url or '')
    local title = tostring(data.title or '')
    if url == '' then
        cb('no_url')
        return
    end
    if isInVehicle and currentVehicle then
        local vehicleNetId = NetworkGetNetworkIdFromEntity(currentVehicle)
        TriggerServerEvent('radioweb:playCustomRadio', vehicleNetId, url, title)
    else
        print('playCustom: Not in vehicle or no current vehicle')
    end
    cb('ok')
end)

-- NUI callback to close UI
RegisterNUICallback('closeUI', function(_, cb)
    HideUI()
    cb('ok')
end)

-- NUI callback to stop radio
RegisterNUICallback('stopRadio', function(_, cb)
    if isInVehicle and currentVehicle then
        local vehicleNetId = NetworkGetNetworkIdFromEntity(currentVehicle)
        TriggerServerEvent('radioweb:selectRadio', vehicleNetId, 0)
    else
        print('stopRadio: Not in vehicle or no current vehicle')
    end
    cb('ok')
end)

-- NUI callback to create custom station
RegisterNUICallback('createCustom', function(data, cb)
    local tracks = data.tracks
    local stationName = tostring(data.stationName or '')
    local isPublic = data.isPublic and true or false

    if stationName == '' then
        cb('missing_fields')
        return
    end

    if type(tracks) ~= 'table' then
        tracks = {}
    end

    TriggerServerEvent('radioweb:createCustomRadio', nil, nil, isPublic, tracks, stationName)
    cb('ok')
end)

-- NUI callback to delete custom station
RegisterNUICallback('deleteCustom', function(data, cb)
    local id = tonumber(data.id)
    if not id then
        cb('no_id')
        return
    end
    TriggerServerEvent('radioweb:deleteCustomRadio', id)
    cb('ok')
end)

-- NUI callback to add track to existing station
RegisterNUICallback('addTrack', function(data, cb)
    local id = tonumber(data.id)
    local title = tostring(data.title or '')
    local url = tostring(data.url or '')
    if not id or title == '' or url == '' then
        cb('missing_fields')
        return
    end
    TriggerServerEvent('radioweb:addTrackToStation', id, title, url)
    cb('ok')
end)

-- NUI callback to update track
RegisterNUICallback('updateTrack', function(data, cb)
    local id = tonumber(data.id)
    local index = tonumber(data.index)
    local title = tostring(data.title or '')
    local url = tostring(data.url or '')
    if not id or not index or title == '' or url == '' then
        cb('missing_fields')
        return
    end
    TriggerServerEvent('radioweb:updateTrackInStation', id, index, title, url)
    cb('ok')
end)

-- NUI callback to remove track
RegisterNUICallback('removeTrack', function(data, cb)
    local id = tonumber(data.id)
    local index = tonumber(data.index)
    if not id or not index then
        cb('missing_fields')
        return
    end
    TriggerServerEvent('radioweb:removeTrackFromStation', id, index)
    cb('ok')
end)

-- NUI callback to set volume (0-100)
RegisterNUICallback('setVolume', function(data, cb)
    local vol = tonumber(data.volume) or 100
    vol = math.max(0, math.min(100, vol))
    userVolume = vol / 100.0
    -- apply to current sound if present
    local soundName = nil
    local vehicle = currentVehicle
    if vehicle and DoesEntityExist(vehicle) then
        soundName = 'car_radio_' .. NetworkGetNetworkIdFromEntity(vehicle)
    end
    if soundName and xsound:getInfo(soundName) then
        local inVeh = IsPedInVehicle(PlayerPedId(), vehicle, false)
        xsound:setVolume(soundName, getVolume(inVeh))
    end
    -- only push back to UI when not a live scrub to avoid loops
    if not data.live then
        SendNUIMessage({ type = 'volume', value = vol })
    end
    cb('ok')
end)

-- Periodic radio refresh
Citizen.CreateThread(function()
    while true do
        Citizen.Wait(30000) -- Refresh every 30 seconds
        FetchRadioStations()
    end
end)
