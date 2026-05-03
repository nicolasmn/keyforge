import { render } from 'solid-js/web'
import App from './App'

const root = document.getElementById('app')
if (!root) throw new Error('#app element not found')

render(() => <App />, root)
