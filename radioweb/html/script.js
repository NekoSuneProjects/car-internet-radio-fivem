let uiVisible = false;

document.addEventListener('DOMContentLoaded', () => {
    const radioUI = document.getElementById('radio-ui');
    const radioSelect = document.getElementById('radio-select');
    const songTitle = document.getElementById('song-title');
    const closeBtn = document.getElementById('close-btn');
    const customName = document.getElementById('custom-name');
    const customUrl = document.getElementById('custom-url');
    const customList = document.getElementById('custom-list');
    const stopBtn = document.getElementById('stop-btn');
    const stationName = document.getElementById('station-name');
    const stationPublic = document.getElementById('station-public');
    const manageModal = document.getElementById('manage-modal');
    const manageClose = document.getElementById('manage-close');
    const manageTitle = document.getElementById('manage-title');
    const manageTrackTitle = document.getElementById('manage-track-title');
    const manageTrackUrl = document.getElementById('manage-track-url');
    const manageSaveTrack = document.getElementById('manage-save-track');
    const manageNewTrack = document.getElementById('manage-new-track');
    const manageTrackList = document.getElementById('manage-track-list');
    const volumeSlider = document.getElementById('volume-slider');
    const volumeValue = document.getElementById('volume-value');
    const nowPlaying = document.getElementById('now-playing');
    const npTitle = document.getElementById('np-title');
    const npStation = document.getElementById('np-station');

    let latestGlobalRadios = [];
    let latestCustomRadios = [];
    let latestCurrentRadio = null;
    let latestCurrentSong = 'Unknown';

    let manageStationId = null;
    let manageTracks = [];
    let manageEditingIndex = null;
    let nowPlayingTimer = null;

    radioUI.classList.add('hidden');

    window.addEventListener('message', (event) => {
        const data = event.data;
        if (data.type === 'show' || data.type === 'select') {
            latestGlobalRadios = Array.isArray(data.radios) ? data.radios : [];
            latestCustomRadios = Array.isArray(data.customRadios) ? data.customRadios : [];
            latestCurrentRadio = data.currentRadio != null ? String(data.currentRadio) : null;
            latestCurrentSong = data.currentSong || 'Unknown';
            renderUI();
            if (typeof data.volume === 'number') {
                setVolumeUI(data.volume);
            }

            radioUI.classList.remove('hidden', 'animate-slide-out');
            radioUI.classList.add('animate-slide-in');
            uiVisible = true;
        } else if (data.type === 'hide' || data.type === 'disable') {
            radioUI.classList.remove('animate-slide-in');
            radioUI.classList.add('animate-slide-out');
            setTimeout(() => {
                radioUI.classList.add('hidden');
                uiVisible = false;
            }, 300);
        } else if (data.type === 'enable') {
            // no-op
        } else if (data.type === 'nowPlaying') {
            showNowPlaying(data.title, data.station);
        } else if (data.type === 'hideNowPlaying') {
            hideNowPlaying();
        } else if (data.type === 'volume') {
            if (typeof data.value === 'number') {
                setVolumeUI(data.value);
            }
        }
    });

    function showNowPlaying(title, station) {
        if (nowPlayingTimer) {
            clearTimeout(nowPlayingTimer);
            nowPlayingTimer = null;
        }
        npTitle.textContent = title || 'Unknown';
        npStation.textContent = station || 'Radio';
        nowPlaying.classList.remove('hidden', 'animate-slide-out');
        nowPlaying.classList.add('animate-slide-in');
        nowPlayingTimer = setTimeout(() => {
            hideNowPlaying();
        }, 20000);
    }

    function hideNowPlaying() {
        if (nowPlayingTimer) {
            clearTimeout(nowPlayingTimer);
            nowPlayingTimer = null;
        }
        nowPlaying.classList.remove('animate-slide-in');
        nowPlaying.classList.add('animate-slide-out');
        setTimeout(() => nowPlaying.classList.add('hidden'), 300);
    }

    function setVolumeUI(val) {
        const clamped = Math.max(0, Math.min(100, Math.round(val)));
        if (volumeSlider) volumeSlider.value = clamped;
        if (volumeValue) volumeValue.textContent = `${clamped}%`;
    }

    if (volumeSlider) {
        volumeSlider.addEventListener('input', () => {
            const val = Number(volumeSlider.value) || 0;
            setVolumeUI(val);
            fetch(`https://${GetParentResourceName()}/setVolume`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ volume: val, live: true })
            }).catch(() => {});
        });
    }

    function renderUI() {
        radioSelect.innerHTML = '';
        const offOption = document.createElement('option');
        offOption.value = '0';
        offOption.text = 'Turn Off';
        radioSelect.appendChild(offOption);

        if (latestGlobalRadios.length) {
            const group = document.createElement('optgroup');
            group.label = 'Global';
            latestGlobalRadios.forEach((radio, idx) => {
                const opt = document.createElement('option');
                opt.value = `g:${idx + 1}`;
                opt.text = `${radio.name} (${radio.owner})`;
                group.appendChild(opt);
            });
            radioSelect.appendChild(group);
        }

        if (latestCustomRadios.length) {
            const group = document.createElement('optgroup');
            group.label = 'Custom';
            latestCustomRadios.forEach((radio) => {
                const opt = document.createElement('option');
                opt.value = `c:${radio.id}`;
                opt.text = `${radio.name || radio.title} ${radio.isPublic ? '(Public)' : '(Private)'}`;
                group.appendChild(opt);
            });
            radioSelect.appendChild(group);
        }

        if (latestCurrentRadio != null) {
            const desired = String(latestCurrentRadio);
            const hasOption = Array.from(radioSelect.options).some(opt => opt.value === desired || opt.value === `g:${desired}` || opt.value === `c:${desired}`);
            radioSelect.value = hasOption ? desired : '0';
        } else {
            radioSelect.value = '0';
        }

        songTitle.textContent = `Song: ${latestCurrentSong}`;

        if (latestCustomRadios.length) {
            customList.innerHTML = '';
            latestCustomRadios.forEach(radio => {
                const trackCount = (radio.tracks && radio.tracks.length) || 0;
                const editable = radio.editable;
                const row = document.createElement('div');
                row.className = 'flex items-center justify-between bg-gray-900/70 border border-gray-700 rounded-lg p-3';
                row.innerHTML = `
                    <div>
                        <p class="text-sm font-semibold text-white">${radio.name || radio.title}</p>
                        <p class="text-xs text-gray-400 break-all">${trackCount} track${trackCount === 1 ? '' : 's'}</p>
                        <p class="text-[11px] text-gray-500 mt-1">${radio.isPublic ? 'Public' : 'Private'}</p>
                    </div>
                    <div class="flex gap-2">
                        <button data-play="${radio.id}" class="play-custom px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-gray-900 rounded-md text-xs font-bold transition-colors">Play</button>
                        ${editable ? `
                        <button data-add="${radio.id}" class="add-custom px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-md text-xs font-bold transition-colors">Manage Tracks</button>
                        <button data-delete="${radio.id}" class="delete-custom px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-md text-xs font-bold transition-colors">Delete</button>
                        ` : ''}
                    </div>
                `;
                customList.appendChild(row);
            });
        } else {
            customList.innerHTML = '<p class="text-gray-400 text-sm">No custom stations yet.</p>';
        }
    }

    document.getElementById('select-btn').addEventListener('click', () => {
        fetch(`https://${GetParentResourceName()}/selectRadio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ index: radioSelect.value })
        }).then(resp => resp.text()).catch(() => {});
    });

    document.getElementById('custom-btn').addEventListener('click', () => {
        const title = customName.value.trim();
        const url = customUrl.value.trim();
        if (!url) return;
        fetch(`https://${GetParentResourceName()}/playCustom`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, title })
        }).then(resp => resp.text()).catch(() => {});
    });

    document.getElementById('save-station').addEventListener('click', () => {
        const name = stationName.value.trim();
        const isPublic = stationPublic.checked;
        if (!name) return;
        fetch(`https://${GetParentResourceName()}/createCustom`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stationName: name, tracks: [], isPublic })
        }).then(resp => resp.text()).then(() => {
            stationName.value = '';
            stationPublic.checked = false;
        }).catch(() => {});
    });

    closeBtn.addEventListener('click', () => {
        fetch(`https://${GetParentResourceName()}/closeUI`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        }).then(resp => resp.text()).catch(() => {});
    });

    stopBtn.addEventListener('click', () => {
        fetch(`https://${GetParentResourceName()}/stopRadio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        }).then(resp => resp.text()).catch(() => {});
    });

    customList.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const playId = btn.getAttribute('data-play');
        const deleteId = btn.getAttribute('data-delete');
        const addId = btn.getAttribute('data-add');

        if (playId) {
            fetch(`https://${GetParentResourceName()}/selectRadio`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ index: `c:${playId}` })
            }).then(resp => resp.text()).catch(() => {});
        }
        if (deleteId) {
            fetch(`https://${GetParentResourceName()}/deleteCustom`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: Number(deleteId) })
            }).then(resp => resp.text()).catch(() => {});
        }
        if (addId) {
            openManageModal(Number(addId));
        }
    });

    function openManageModal(stationId) {
        const station = latestCustomRadios.find(r => r.id === stationId);
        if (!station || !station.editable) return;
        manageStationId = stationId;
        manageTracks = Array.isArray(station.tracks) ? station.tracks.slice() : [];
        manageEditingIndex = null;
        manageTitle.textContent = station.name || 'Station';
        manageTrackTitle.value = '';
        manageTrackUrl.value = '';
        renderManageTracks();
        manageModal.classList.remove('hidden');
    }

    function closeManageModal() {
        manageModal.classList.add('hidden');
        manageStationId = null;
        manageTracks = [];
        manageEditingIndex = null;
    }

    function renderManageTracks() {
        manageTrackList.innerHTML = '';
        if (!manageTracks.length) {
            manageTrackList.innerHTML = '<tr><td colspan="3" class="px-3 py-3 text-center text-gray-400">No tracks yet.</td></tr>';
            return;
        }
        manageTracks.forEach((track, idx) => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-800/50';
            tr.innerHTML = `
                <td class="px-3 py-2 text-gray-300">${idx + 1}</td>
                <td class="px-3 py-2 text-gray-100">
                    <div class="truncate">${track.title || 'Untitled'}</div>
                    <div class="text-[11px] text-gray-500 truncate">${track.url}</div>
                </td>
                <td class="px-3 py-2">
                    <div class="flex gap-2">
                        <button data-edit="${idx}" class="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-xs rounded">Edit</button>
                        <button data-remove="${idx}" class="px-2 py-1 bg-red-600 hover:bg-red-500 text-xs rounded">Delete</button>
                    </div>
                </td>
            `;
            manageTrackList.appendChild(tr);
        });
    }

    manageTrackList.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const editIdx = btn.getAttribute('data-edit');
        const removeIdx = btn.getAttribute('data-remove');
        if (editIdx !== null) {
            const idx = Number(editIdx);
            const track = manageTracks[idx];
            if (track) {
                manageEditingIndex = idx;
                manageTrackTitle.value = track.title || '';
                manageTrackUrl.value = track.url || '';
            }
        }
        if (removeIdx !== null) {
            const idx = Number(removeIdx);
            if (manageTracks[idx]) {
                fetch(`https://${GetParentResourceName()}/removeTrack`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: manageStationId, index: idx + 1 })
                }).then(resp => resp.text()).then(() => {
                    manageTracks.splice(idx, 1);
                    renderManageTracks();
                    updateStationTracks(manageStationId, manageTracks);
                }).catch(() => {});
            }
        }
    });

    manageSaveTrack.addEventListener('click', () => {
        if (manageStationId == null) return;
        const title = manageTrackTitle.value.trim();
        const url = manageTrackUrl.value.trim();
        if (!title || !url) return;

        if (manageEditingIndex !== null) {
            fetch(`https://${GetParentResourceName()}/updateTrack`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: manageStationId, index: manageEditingIndex + 1, title, url })
            }).then(resp => resp.text()).then(() => {
                manageTracks[manageEditingIndex] = { title, url };
                renderManageTracks();
                updateStationTracks(manageStationId, manageTracks);
            }).catch(() => {});
        } else {
            fetch(`https://${GetParentResourceName()}/addTrack`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: manageStationId, title, url })
            }).then(resp => resp.text()).then(() => {
                manageTracks.push({ title, url });
                renderManageTracks();
                updateStationTracks(manageStationId, manageTracks);
            }).catch(() => {});
        }
    });

    manageNewTrack.addEventListener('click', () => {
        manageEditingIndex = null;
        manageTrackTitle.value = '';
        manageTrackUrl.value = '';
        manageTrackTitle.focus();
    });

    manageClose.addEventListener('click', closeManageModal);
    manageModal.addEventListener('click', (e) => {
        if (e.target === manageModal) {
            closeManageModal();
        }
    });

    function updateStationTracks(stationId, tracks) {
        latestCustomRadios = latestCustomRadios.map(st => {
            if (st.id === stationId) {
                return { ...st, tracks: tracks.slice() };
            }
            return st;
        });
        renderUI();
    }
});
