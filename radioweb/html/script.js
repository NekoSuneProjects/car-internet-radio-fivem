let uiVisible = false;

window.addEventListener('message', (event) => {
    const data = event.data;
    
    if (data.type === 'show') {
        const select = document.getElementById('radio-select');
        select.innerHTML = '<option value="0">Turn Off</option>';
        data.radios.forEach((radio, index) => {
            const option = document.createElement('option');
            option.value = index + 1;
            option.text = radio.name;
            if (data.currentRadio === index + 1) {
                option.selected = true;
            }
            select.appendChild(option);
        });
        document.getElementById('song-title').textContent = `Song: ${data.currentSong}`;
        document.getElementById('radio-ui').classList.remove('hidden');
        uiVisible = true;
    } else if (data.type === 'hide') {
        document.getElementById('radio-ui').classList.add('hidden');
        uiVisible = false;
    } else if (data.type === 'select') {
        document.getElementById('radio-ui').classList.remove('hidden');
        uiVisible = true;
    } else if (data.type === 'enable') {
        document.getElementById('radio-ui').style.display = 'block';
    } else if (data.type === 'disable') {
        document.getElementById('radio-ui').style.display = 'none';
    }
});

document.getElementById('select-btn').addEventListener('click', () => {
    const select = document.getElementById('radio-select');
    const index = select.value;
    fetch(`https://${GetParentResourceName()}/selectRadio`, {
        method: 'POST',
        body: JSON.stringify({ index })
    });
});