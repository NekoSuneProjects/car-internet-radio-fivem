local xsound = exports.xsound
local isInVehicle = false
local currentRadio = nil
local currentSong = nil
local uiVisible = false
local currentVehicle = nil
local radioStations = {}

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

-- Show UI
local function ShowUI()
    SendNUIMessage({
        type = 'show',
        radios = radioStations,
        currentRadio = currentRadio,
        currentSong = currentSong or 'Unknown'
    })
    uiVisible = true
    SetNuiFocus(true, true) -- Enable mouse cursor and focus
end

-- Hide UI
local function HideUI()
    SendNUIMessage({ type = 'hide' })
    uiVisible = false
    SetNuiFocus(false, false) -- Disable mouse cursor and focus
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
                print('Failed to fetch radio stations: No valid endpoints')
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
                    end
                else
                    print('Failed to fetch radio stations (client, endpoint ' .. endpoints[index] .. '): HTTP ' .. status)
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
    end
end)

-- Play radio
local function PlayRadio(index, vehicleNetId)
    local radio = radioStations[index]
    if radio then
        currentRadio = index
        currentSong = radio.song or 'Unknown'
        xsound:PlayUrlPos('car_radio_' .. vehicleNetId, radio.url, 0.5, GetEntityCoords(GetVehiclePedIsIn(PlayerPedId(), false)), false)
        xsound:Distance('car_radio_' .. vehicleNetId, 10.0)
        ShowUI()
    end
end

-- Stop radio
local function StopRadio(vehicleNetId)
    if currentRadio then
        xsound:Destroy('car_radio_' .. vehicleNetId)
        currentRadio = nil
        currentSong = nil
        SendNUIMessage({ type = 'hide' })
        uiVisible = false
    end
end

-- Sync radio state
RegisterNetEvent('radioweb:syncRadio')
AddEventHandler('radioweb:syncRadio', function(vehicleNetId, radioIndex)
    local vehicle = NetworkGetEntityFromNetworkId(vehicleNetId)
    if DoesEntityExist(vehicle) and GetVehiclePedIsIn(PlayerPedId(), false) == vehicle then
        if radioIndex == 0 then
            StopRadio(vehicleNetId)
        else
            PlayRadio(radioIndex, vehicleNetId)
        end
    end
end)

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
                SendNUIMessage({ type = 'enable' })
            end
            
            if isInVehicle and IsControlJustPressed(0, Config.UIKey) then
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

-- NUI callback for radio selection
RegisterNUICallback('selectRadio', function(data, cb)
    local index = tonumber(data.index)
    if isInVehicle and currentVehicle then
        local vehicleNetId = NetworkGetNetworkIdFromEntity(currentVehicle)
        TriggerServerEvent('radioweb:selectRadio', vehicleNetId, index)
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