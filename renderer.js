window.api.onShowScreenshots((_event,screenshots) => {
    const container = document.getElementById('screenshos-container');
    container.innerHTML = ''; 

    screenshots.forEach((filePath) => {
        const img = document.createElement('img');
        console.log(filePath)
        img.src = `file://${filePath}`;
        img.style.border = '1px solid #ccc';
        container.appendChild(img);
    });

});

window.api.showText((_event, result) => {
  const explanationEl = document.getElementById('explanation');
  const codeBlockEl = document.getElementById('code-block');

  explanationEl.innerHTML = result.text;
  codeBlockEl.innerHTML = result.code;
});


window.api.captureMode((_event,mode)=>{
    const container = document.getElementById('capture-Mode');
    container.innerHTML = mode;
})
window.api.scroller((_event, direction) => {
  const container = document.getElementById('text-display');
  if (container) {
    const amount = 100; 
    container.scrollTop += direction === 'Down' ? amount : -amount;
  }
});

window.api.message((_event, message) => {
  const  container = document.getElementById('message-display');
  container.innerHTML = '';
  container.innerHTML = message;
});

window.api.voice((_event,message) =>{
  const container = document.getElementById('display-transcribe');
  console
  container.innerHTML += message;
})