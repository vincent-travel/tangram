import Tile from './tile';
import TilePyramid from './tile_pyramid';
import log from './utils/log';
import WorkerBroker from './utils/worker_broker';

export default class TileManager {

    constructor({ scene, view }) {
        this.scene = scene;
        this.view = view;
        this.tiles = {};
        this.pyramid = new TilePyramid();
        this.visible_coords = {};
        this.queued_coords = [];
        this.queued_tiles = [];
        this.last_build_time = 0;
        this.building_tiles = null;
        this.renderable_tiles = [];
        this.active_styles = [];

        // Provide a hook for this object to be called from worker threads
        this.main_thread_target = ['TileManager', this.scene.id].join('_');
        WorkerBroker.addTarget(this.main_thread_target, this);
    }

    destroy() {
        this.forEachTile(tile => tile.destroy());
        this.tiles = {};
        this.pyramid = null;
        this.visible_coords = {};
        this.queued_coords = [];
        this.queued_tiles = [];
        this.last_build_time = 0;
        this.scene = null;
        this.view = null;
    }

    keepTile(tile) {
        this.tiles[tile.key] = tile;
        this.pyramid.addTile(tile);
    }

    hasTile(key) {
        return this.tiles[key] !== undefined;
    }

    forgetTile(key) {
        if (this.hasTile(key)) {
            let tile = this.tiles[key];
            this.pyramid.removeTile(tile);
        }

        delete this.tiles[key];
        this.tileBuildStop(key);
    }

    // Remove a single tile
    removeTile(key) {
        log('trace', `tile unload for ${key}`);

        var tile = this.tiles[key];

        if (tile != null) {
            tile.destroy();
        }

        this.forgetTile(tile.key);
        this.scene.requestRedraw();
    }

    // Run a function on each tile
    forEachTile(func) {
        for (let t in this.tiles) {
            func(this.tiles[t]);
        }
    }

    // Remove tiles that pass a filter condition
    removeTiles(filter) {
        let remove_tiles = [];
        for (let t in this.tiles) {
            let tile = this.tiles[t];
            if (filter(tile)) {
                remove_tiles.push(t);
            }
        }
        for (let r=0; r < remove_tiles.length; r++) {
            let key = remove_tiles[r];
            this.removeTile(key);
        }
    }

    updateTilesForView() {
        // Find visible tiles and load new ones
        let prev_coords = Object.keys(this.visible_coords);
        this.visible_coords = {};
        let tile_coords = this.view.findVisibleTileCoordinates();
        for (let c=0; c < tile_coords.length; c++) {
            const coords = tile_coords[c];
            this.queueCoordinate(coords);
            this.visible_coords[coords.key] = coords;
        }

        // Check if visible coords changed
        // TODO: move to a new view manager object
        let new_coords = Object.keys(this.visible_coords);
        let coords_changed = false;
        if (prev_coords.length !== new_coords.length) {
            coords_changed = true;
        }
        else {
            prev_coords.sort();
            new_coords.sort();
            if (!prev_coords.every((c, i) => new_coords[i] === c)) {
                coords_changed = true;
            }
        }

        this.updateTileStates();
    }

    updateTileStates () {
        this.forEachTile(tile => {
            this.updateVisibility(tile);
            tile.update();
        });

        this.loadQueuedCoordinates();
        this.updateProxyTiles();
        this.view.pruneTilesForView();
        this.updateRenderableTiles();
        this.updateActiveStyles();
    }

    updateProxyTiles () {
        if (this.view.zoom_direction === 0) {
            return;
        }

        // Clear previous proxies
        this.forEachTile(tile => tile.setProxyFor(null));

        let proxy = false;
        this.forEachTile(tile => {
            if (this.view.zoom_direction === 1) {
                if (tile.visible && !tile.built && tile.coords.z > 0) {
                    const parent = this.pyramid.getAncestor(tile);
                    if (parent) {
                        parent.setProxyFor(tile);
                        proxy = true;
                    }
                }
            }
            else if (this.view.zoom_direction === -1) {
                if (tile.visible && !tile.built) {
                    const descendants = this.pyramid.getDescendants(tile);
                    for (let i=0; i < descendants.length; i++) {
                        descendants[i].setProxyFor(tile);
                        proxy = true;
                    }
                }
            }
        });

        if (!proxy) {
            this.view.zoom_direction = 0;
        }
    }

    updateVisibility(tile) {
        tile.visible = false;
        if (tile.style_zoom === this.view.tile_zoom) {
            if (this.visible_coords[tile.coords.key]) {
                tile.visible = true;
            }
            else {
                // brute force
                for (let key in this.visible_coords) {
                    if (Tile.isDescendant(tile.coords, this.visible_coords[key])) {
                        tile.visible = true;
                        break;
                    }
                }
            }
        }
    }

    // Remove tiles that aren't visible, and flag remaining visible ones to be updated (for loading, proxy, etc.)
    pruneToVisibleTiles () {
        this.removeTiles(tile => !tile.visible);
    }

    getRenderableTiles () {
        return this.renderable_tiles;
    }

    updateRenderableTiles() {
        this.renderable_tiles = [];
        for (let t in this.tiles) {
            let tile = this.tiles[t];
            if (tile.visible && tile.loaded) {
                this.renderable_tiles.push(tile);
            }
        }
        return this.renderable_tiles;
    }

    getActiveStyles () {
        return this.active_styles;
    }

    updateActiveStyles () {
        let tiles = this.renderable_tiles;
        let active = {};
        for (let t=0; t < tiles.length; t++) {
            let tile = tiles[t];
            Object.keys(tile.meshes).forEach(s => active[s] = true);
        }
        this.active_styles = Object.keys(active);
        return this.active_styles;
    }

    isLoadingVisibleTiles() {
        return Object.keys(this.tiles).some(k => this.tiles[k].visible && !this.tiles[k].built);
    }

    // Queue a tile for load
    queueCoordinate(coords) {
        this.queued_coords[this.queued_coords.length] = coords;
    }

    // Load all queued tiles
    loadQueuedCoordinates() {
        if (this.queued_coords.length === 0) {
            return;
        }

        // Sort queued tiles from center tile
        this.queued_coords.sort((a, b) => {
            let ad = Math.abs(this.view.center.tile.x - a.x) + Math.abs(this.view.center.tile.y - a.y);
            let bd = Math.abs(this.view.center.tile.x - b.x) + Math.abs(this.view.center.tile.y - b.y);
            return (bd > ad ? -1 : (bd === ad ? 0 : 1));
        });
        this.queued_coords.forEach(coords => this.loadCoordinate(coords));
        this.queued_coords = [];
    }

    // Load all tiles to cover a given logical tile coordinate
    loadCoordinate(coords) {
        // Skip if not at current scene zoom
        if (coords.z !== this.view.center.tile.z) {
            return;
        }

        // Determine necessary tiles for each source
        for (let s in this.scene.sources) {
            let source = this.scene.sources[s];
            // Check if data source should build this tile
            if (!source.builds_geometry_tiles || !source.includesTile(coords, this.view.tile_zoom)) {
                continue;
            }

            let key = Tile.key(coords, source, this.view.tile_zoom);
            if (key && !this.hasTile(key)) {
                let tile = Tile.create({
                    source,
                    coords,
                    worker: this.scene.getWorkerForDataSource(source),
                    style_zoom: this.view.styleZoom(coords.z),
                    view: this.view
                });

                this.keepTile(tile);
                this.buildTile(tile);
            }
        }
    }

    // Sort and build a list of tiles
    buildTiles(tiles) {
        Tile.sort(tiles).forEach(tile => this.buildTile(tile));
        this.checkBuildQueue();
    }

    buildTile(tile, options) {
        this.tileBuildStart(tile.key);
        this.updateVisibility(tile);
        tile.update();
        tile.markForBuild(this.scene.generation, options);
        this.queued_tiles.push(tile);
    }

    loadQueuedTiles(view) {
        const now = +new Date();

        // 30, 250
        if (now - view.last_zoom_time < 50 &&
            now - this.last_build_time < 250) { // NB: consider disabling for FF
            return;
        }

        if (this.queued_tiles.length > 0) {
            this.last_build_time = +new Date();

            console.log('*** PROCESS TILE BUILD QUEUE ***');

            this.queued_tiles.forEach(tile => tile.buildOnWorker());
            this.queued_tiles = [];
        }
    }

    clearQueuedTiles() {
        this.queued_tiles = [];
        this.last_build_time = 0;
    }

    // Called on main thread when a web worker completes processing for a single tile (initial load, or rebuild)
    buildTileStylesCompleted({ tile, progress }) {
        // Removed this tile during load?
        if (this.tiles[tile.key] == null) {
            log('trace', `discarded tile ${tile.key} in TileManager.buildTileStylesCompleted because previously removed`);
            Tile.abortBuild(tile);
            this.updateTileStates();
        }
        // Built with an outdated scene configuration?
        else if (tile.generation !== this.scene.generation) {
            log('debug', `discarded tile ${tile.key} in TileManager.buildTileStylesCompleted because built with ` +
                `scene config gen ${tile.generation}, current ${this.scene.generation}`);
            Tile.abortBuild(tile);
            this.updateTileStates();
        }
        else {
            // Update tile with properties from worker
            if (this.tiles[tile.key]) {
                tile = this.tiles[tile.key].merge(tile);
            }

            if (progress.done) {
                tile.built = true;
            }

            tile.buildMeshes(this.scene.styles, progress);
            this.updateTileStates();
            this.scene.requestRedraw();
        }

        if (progress.done) {
            this.tileBuildStop(tile.key);
        }
    }

    // Called on main thread when web worker encounters an error building a tile
    buildTileError(tile) {
        log('error', `Error building tile ${tile.key}:`, tile.error);
        this.forgetTile(tile.key);
        Tile.abortBuild(tile);
    }

    // Track tile build state
    tileBuildStart(key) {
        this.building_tiles = this.building_tiles || {};
        this.building_tiles[key] = true;
        log('trace', `tileBuildStart for ${key}: ${Object.keys(this.building_tiles).length}`);
    }

    tileBuildStop(key) {
        // Done building?
        if (this.building_tiles) {
            log('trace', `tileBuildStop for ${key}: ${Object.keys(this.building_tiles).length}`);
            delete this.building_tiles[key];
            this.checkBuildQueue();
        }
    }

    // Check status of tile building queue and notify scene when we're done
    checkBuildQueue() {
        if (!this.building_tiles || Object.keys(this.building_tiles).length === 0) {
            this.building_tiles = null;
            this.scene.tileManagerBuildDone();
        }
    }

    // Sum of a debug property across tiles
    getDebugSum(prop, filter) {
        var sum = 0;
        for (var t in this.tiles) {
            if (this.tiles[t].debug[prop] != null && (typeof filter !== 'function' || filter(this.tiles[t]) === true)) {
                sum += this.tiles[t].debug[prop];
            }
        }
        return sum;
    }

    // Average of a debug property across tiles
    getDebugAverage(prop, filter) {
        return this.getDebugSum(prop, filter) / Object.keys(this.tiles).length;
    }

}
