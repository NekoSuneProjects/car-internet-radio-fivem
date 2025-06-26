local xsound = exports.xsound
local isInVehicle = false
local currentRadio = nil
local currentSong = nil
local uiVisible = false
local currentVehicle = nil
local radioStations = {}
local activeRadios = {} -- Track active radio instances

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
    SetNuiFocus(false, false) -- Disable mouse cursor and focus
end

-- Show UI
local function ShowUI()
    if not radioStations or #radioStations == 0 then
        return
    end
    SendNUIMessage({
        type = 'show',
        radios = radioStations,
        currentRadio = currentRadio,
        currentSong = currentSong or 'Unknown'
    })
    uiVisible = true
    SetNuiFocus(true, true) -- Enable mouse cursor and focus
    SetTimeout(Config.UIFadeTime, function()
        if uiVisible then
            HideUI()
        end
    end)
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
                        if currentRadio and radioStations[currentRadio] and radioStations[currentRadio].song ~= currentSong then
                            currentSong = radioStations[currentRadio].song
                            if isInVehicle then
                                ShowUI()
                            end
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
        if currentRadio and radioStations[currentRadio] and radioStations[currentRadio].song ~= currentSong then
            currentSong = radioStations[currentRadio].song
            if isInVehicle then
                ShowUI()
            end
        end
    else
        print('receiveRadios: No data received from server')
    end
end)

-- Play radio
local function PlayRadio(index, vehicleNetId)
    local radio = radioStations[index]
    if radio then
        currentRadio = index
        currentSong = radio.song or 'Unknown'
        local vehicle = NetworkGetEntityFromNetworkId(vehicleNetId)
        if not DoesEntityExist(vehicle) then
            return
        end
        local playerPed = PlayerPedId()
        local coords = GetEntityCoords(vehicle)
        local volume = IsPedInVehicle(playerPed, vehicle, false) and 0.5 or 0.1 -- Louder inside, faint outside
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
        if IsPedInVehicle(playerPed, vehicle, false) then
            ShowUI()
        end
    else
        print('PlayRadio: Invalid radio index or no radio data')
    end
end

-- Stop radio
local function StopRadio(vehicleNetId)
    if currentRadio then
        local soundName = 'car_radio_' .. vehicleNetId
        xsound:Destroy(soundName)
        activeRadios[vehicleNetId] = nil -- Remove from active radios
        currentRadio = nil
        currentSong = nil
        if uiVisible then
            HideUI()
        end
    end
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
            PlayRadio(radioIndex, vehicleNetId)
        end
        -- Update volume for nearby players
        if not IsPedInVehicle(playerPed, vehicle, false) then
            xsound:SetVolume('car_radio_' .. vehicleNetId, 0.1)
        end
    else
        print('SyncRadio: Vehicle does not exist for netId', vehicleNetId)
    end
end)

-- Register /radio command
RegisterCommand('radio', function(source, args, rawCommand)
    local playerPed = PlayerPedId()
    local vehicle = GetVehiclePedIsIn(playerPed, false)
    if vehicle ~= 0 and not IsVehicleBlacklisted(vehicle) then
        if not uiVisible then
            ShowUI()
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
                StopRadio(NetworkGetNetworkIdFromEntity(currentVehicle)) -- Ensure custom radio is off by default
            end
            
            if isInVehicle and Config.EnableUIKey and IsControlJustPressed(0, Config.UIKey) then
                if not uiVisible then
                    ShowUI()
                else
                    HideUI()
                end
            end
        else
            if isInVehicle then
                isInVehicle = false
                StopRadio(currentVehicle and NetworkGetNetworkIdFromEntity(currentVehicle) or 0)
                SendNUIMessage({ type = 'disable' })
                if uiVisible then
                    HideUI()
                end
            end
        end
    end
end)

-- Only update radio position for the local player’s vehicle
Citizen.CreateThread(function()
    while true do
        Citizen.Wait(200) -- Every 30 seconds
        local playerPed = PlayerPedId()
        local vehicle = GetVehiclePedIsIn(playerPed, false)

        if vehicle ~= 0 and DoesEntityExist(vehicle) then
            local vehicleNetId = NetworkGetNetworkIdFromEntity(vehicle)
            if activeRadios[vehicleNetId] then
                local soundName = 'car_radio_' .. vehicleNetId
                local coords = GetEntityCoords(PlayerPedId(), false)
                local info = xsound:getInfo(soundName)

                if info and info.playing then
                    xsound:Position(soundName, coords)
                else
                    if currentRadio and radioStations[currentRadio] then
                        local volume = 0.5
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
                    else
                        activeRadios[vehicleNetId] = nil
                    end
                end
            end
        end
    end
end)


-- NUI callback for radio selection
RegisterNUICallback('selectRadio', function(data, cb)
    local index = tonumber(data.index)
    if isInVehicle and currentVehicle then
        local vehicleNetId = NetworkGetNetworkIdFromEntity(currentVehicle)
        TriggerServerEvent('radioweb:selectRadio', vehicleNetId, index)
    else
        print('selectRadio: Not in vehicle or no current vehicle')
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