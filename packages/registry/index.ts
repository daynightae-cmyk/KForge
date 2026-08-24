/**
 * First-party Registry for KForge
 * Provides local package management with install, update, uninstall capabilities
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

class FirstPartyRegistry {
  constructor(basePath = './packages') {
    this.basePath = basePath;
    this.packageCache = {};
  }

  /**
   * Initialize the registry by scanning available packages
   */
  scanPackages() {
    const packagesDir = join(this.basePath, 'packages');
    if (!existsSync(packagesDir)) {
      return [];
    }

    const packages = [];
    const packageFiles = fs.readdirSync(packagesDir)
      .filter(f => f.toLowerCase().endsWith('.js') || f.toLowerCase().endsWith('.json'))
      .map(f => {
        const fullPath = join(packagesDir, f);
        if (fs.statSync(fullPath).isFile()) {
          return fullPath;
        }
      });

    packages.forEach(pkgPath => {
      try {
        const pkgInfo = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkgInfo.name && pkgInfo.version) {
          packages.push({
            name: pkgInfo.name,
            version: pkgInfo.version,
            path: pkgPath
          });
        }
      } catch (err) {
        // Skip corrupted package files
        console.warn(`Failed to parse ${pkgPath}: ${err.message}`);
      }
    });

    return packages;
  }

  /**
   * Register a new package in the local registry
   */
  registerPackage(name, version, path) {
    if (!this.packageCache[name]) {
      this.packageCache[name] = {
        name,
        version,
        path,
        installed: false,
        version: version
      };
    }
    return this.packageCache[name];
  }

  /**
   * Check if a package is installed
   */
  isInstalled(name) {
    return this.packageCache[name]?.installed === true;
  }

  /**
   * Get package information
   */
  getPackage(name) {
    return this.packageCache[name] || null;
  }

  /**
   * List all installed packages
   */
  listInstalledPackages() {
    return Object.values(this.packageCache)
      .filter(pkg => pkg.installed)
      .sort((a, b) => a.version.localeCompare(b.version));
  }

  /**
   * Install a package (add to registry)
   */
  installPackage(name, version, path) {
    if (this.isInstalled(name)) {
      throw new Error(`Package "${name}" is already installed`);
    }
    this.registerPackage(name, version, path);
    return this.packageCache[name];
  }

  /**
   * Update a package (increment version)
   */
  updatePackage(name, newVersion) {
    if (!this.isInstalled(name)) {
      throw new Error(`Package "${name}" is not installed`);
    }
    this.packageCache[name].version = newVersion;
    this.packageCache[name].installed = true;
    return this.packageCache[name];
  }

  /**
   * Uninstall a package
   */
  uninstallPackage(name) {
    if (!this.isInstalled(name)) {
      throw new Error(`Package "${name}" is not installed`);
    }
    delete this.packageCache[name];
    return true;
  }

  /**
   * Clean up unused packages
   */
  cleanup() {
    const unused = Object.keys(this.packageCache)
      .filter(key => !this.isInstalled(key))
      .sort();
    unused.forEach(name => {
      this.uninstallPackage(name);
    });
  }
}

// Export singleton instance
const registry = new FirstPartyRegistry();
export default registry;
