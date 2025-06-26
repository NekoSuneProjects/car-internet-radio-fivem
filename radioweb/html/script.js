let uiVisible = false;

document.addEventListener('DOMContentLoaded', () => {
    const radioUI = document.getElementById('radio-ui');
    const radioSelect = document.getElementById('radio-select');
    const songTitle = document.getElementById('song-title');

    // Ensure UI is hidden on load
    radioUI.classList.add('hidden');
    console.log('UI initialized: hidden');

    window.addEventListener('message', (event) => {
        const data = event.data;
        console.log('NUI message received:', data);

        if (data.type === 'show' || data.type === 'select') {
            // Populate radio stations
            radioSelect.innerHTML = '<option value="0">Turn Off</option>';
            if (data.radios && Array.isArray(data.radios)) {
                data.radios.forEach((radio, index) => {
                    const option = document.createElement('option');
                    option.value = index + 1; // 1-based index for radios
                    option.text = `${radio.name} (${radio.owner})`;
                    if (data.currentRadio && data.currentRadio === index + 1) {
                        option.selected = true;
                    }
                    radioSelect.appendChild(option);
                });
            } else {
                console.warn('No valid radio data received');
            }
            // Update song title
            songTitle.textContent = `Song: ${data.currentSong || 'Unknown'}`;
            // Show UI with animation
            radioUI.classList.remove('hidden', 'animate-slide-out');
            radioUI.classList.add('animate-slide-in');
            uiVisible = true;
            console.log('UI shown with slide-in animation, uiVisible:', uiVisible);
        } else if (data.type === 'hide' || data.type === 'disable') {
            // Hide UI with animation
            radioUI.classList.remove('animate-slide-in');
            radioUI.classList.add('animate-slide-out');
            setTimeout(() => {
                radioUI.classList.add('hidden');
                uiVisible = false;
                console.log('UI hidden after slide-out animation, uiVisible:', uiVisible);
            }, 300); // Match animation duration
        } else if (data.type === 'enable') {
            // Enable UI interaction (no visual change, keep hidden)
            console.log('UI enabled, remains hidden until show/select, uiVisible:', uiVisible);
        }
    });

    // Handle select button click
    document.getElementById('select-btn').addEventListener('click', () => {
        const index = radioSelect.value;
        console.log('Select button clicked, index:', index);
        fetch(`https://${GetParentResourceName()}/selectRadio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ index })
        }).then(resp => resp.json()).then(resp => {
            console.log('Select radio response:', resp);
        }).catch(err => {
            console.error('Select radio error:', err);
        });
    });
});