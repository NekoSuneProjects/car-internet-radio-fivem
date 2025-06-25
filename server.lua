-- Server-side logic for radio system
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