/**
 * Flarebase SDK Browser Loader
 *
 * This script makes the Flarebase SDK available to browser-based pages.
 * Include this script in your HTML before your application code.
 *
 * Usage:
 *   <script src="/js/flarebase-sdk.js"></script>
 *   <script>
 *     const db = new FlarebaseClient();
 *     await db.login('user@example.com', 'password');
 *   </script>
 */

// Import the SDK module
import FlarebaseClient from '../lib/flarebase-sdk';

// Make it available globally
if (typeof window !== 'undefined') {
  (window as any).FlarebaseClient = FlarebaseClient;
}

// Export for ES module consumers
export default FlarebaseClient;
