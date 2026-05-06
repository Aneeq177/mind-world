document.addEventListener('DOMContentLoaded', async () => {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_STATUS'
    })

    if (response?.email) {
      document.getElementById('email-value').textContent = response.email
    }
  } catch (error) {
    document.getElementById('email-value').textContent = 'Not connected'
    document.getElementById('status-dot').style.background = '#FF4444'
    document.getElementById('status-text').textContent = 'Disconnected'
    document.getElementById('status-text').style.color = '#FF4444'
  }
})
