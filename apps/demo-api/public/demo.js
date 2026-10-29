fetch('/api/health')
  .then((r) => r.json())
  .then((data) => {
    document.querySelector('#mode').textContent = data.mode + ' mode';
  })
  .catch(() => {
    document.querySelector('#mode').textContent = 'Server unavailable';
  });
document
  .querySelector('#investment')
  .addEventListener('submit', async (event) => {
    event.preventDefault();
    const output = document.querySelector('#result');
    try {
      const response = await fetch('/api/investments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          symbol: 'DEMO',
          amount: 100,
          currency: 'USD',
          type: 'monthly',
        }),
      });
      output.textContent =
        'HTTP ' +
        response.status +
        '\n' +
        JSON.stringify(await response.json(), null, 2);
    } catch {
      output.textContent =
        'Request failed. Check that the local demo server is running.';
    }
  });
