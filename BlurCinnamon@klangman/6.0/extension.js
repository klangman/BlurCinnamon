// Blur Cinnamon: Blur some components of the Cinnamon Desktop

// Copyright (c) 2026 Kevin Langman

// Some code bowwowed from the BlurOverview Cinnamon extension Copyright (C) 2012 Jen Bowen aka nailfarmer

// Gaussian Blur (borrowed from Blur-my-shell / Aurélien Hamy) modified for Cinnamon by Kevin Langman 2024
// Rounded Corners (borrowed from Blur-my-shell / Aurélien Hamy) modified for Cinnamon by Kevin Langman 2025

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

const Clutter         = imports.gi.Clutter;
const St              = imports.gi.St;
const Tweener         = imports.ui.tweener;
const Overview        = imports.ui.overview;
const Expo            = imports.ui.expo;
const AppSwitcher3D   = imports.ui.appSwitcher.appSwitcher3D;
const ClassicSwitcher = imports.ui.appSwitcher.classicSwitcher;
const Settings        = imports.ui.settings;
const SignalManager   = imports.misc.signalManager;
const Panel           = imports.ui.panel;
const Main            = imports.ui.main;
const Meta            = imports.gi.Meta;
const Mainloop        = imports.mainloop;
const AppletManager   = imports.ui.appletManager;
const Lang            = imports.lang;
const UPowerGlib      = imports.gi.UPowerGlib;
const MessageTray     = imports.ui.messageTray;
const Util            = imports.misc.util;
const Tooltips        = imports.ui.tooltips;
const WindowMenu      = imports.ui.windowMenu;
const Cinnamon        = imports.gi.Cinnamon;
const DeskletManager  = imports.ui.deskletManager;
const OsdWindow       = imports.ui.osdWindow;
const GLib            = imports.gi.GLib;

// For Plank support (reading X11 property)
imports.gi.versions.Gdk = '3.0';
imports.gi.versions.GdkX11 = '3.0';
const Gdk = imports.gi.Gdk;
const GdkX11 = imports.gi.GdkX11;

try {
   var WorkspaceOsd    = imports.ui.workspaceOsd;
   var usesWorkspaceOsd = true;
} catch(e) {
   var  ModalDialog = imports.ui.modalDialog;
   var usesWorkspaceOsd = false;
}

// For PopupMenu effects
const Applet    = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;

const GaussianBlur = require("./gaussian_blur");
const MonteCarloBlur = require("./monte_carlo_blur");
const DualKawaseBlur = require("./dual_kawase_blur");
const CornerEffect = require("./corner");

const ANIMATION_TIME = 0.25;
const AUTOHIDE_ANIMATION_TIME = 0.2;  // This is a copy of "Panel.AUTOHIDE_ANIMATION_TIME", we can't legally access it since it's a const and EC6 does not allow it

const BLUR_EFFECT_NAME = "blur";
const DESAT_EFFECT_NAME = "desat";
const CORNER_EFFECT_NAME = "corner";

let originalAnimateOverview;
let originalAnimateExpo;
let originalShowAppSwitcher3D;
let originalHideAppSwitcher3D;
let originalSizeChangeWindowDone;

let settings;
let blurClassicSwitcher;
let blurPanels;
let blurPopupMenus;
let blurDesktop;
let blurNotifications;
let blurTooltips;
let blurApplications;
let blurDesklets;
let blurOSD;
let blurFocusEffect;
let metaData;

let cloneManager;

var blurClassicSwitcherThis;
var blurPanelsThis;
var blurPopupMenusThis;
var blurNotificationsThis;
var blurTooltipsThis;
var blurDeskletsThis;
var blurOSDThis;
var blurWorkspaceOsdThis;

const BlurType = {
   None: 0,
   Simple: 1,
   Gaussian: 2,
   Transparent: 3,
   DynamicBlur: 4,    // Dynamic blur using Gaussian
   MonteCarlo: 5,
   DynamicMC: 6,      // Dynamic blur using Monte-Carlo
   DualKawase: 7,
   DynamicDK: 8,      // Dynamic blur using Dual-Kawase
}

const PanelLoc = {
   All: 0,
   Top: 1,
   Bottom: 2,
   Left: 3,
   Right: 4
}

const PanelMonitor = {
   All: 100
}

/*const Component = {
  AltTab: 0,
  Desklets: 1,
  Desktop: 2,
  Expo: 3,
  Menus: 4,
  Notifications: 5,
  Overview: 6,
  Panels: 7,
  Tooltips: 8,
  Windows: 9
}*/

function debugMsg(...params) {
   //log(...params);
}

function printStackTrace(header) {
   log( header );
   var err = new Error();
   log( "Stack:\n"+err.stack );
}

function _animateVisibleOverview() {
   if (this.visible || this.animationInProgress)
      return;

   this._oldAnimateVisible();

   let children = this._background.get_children();

   let blurType = (settings.overviewOverride) ? settings.overviewBlurType : settings.blurType;
   let radius = (settings.overviewOverride) ? settings.overviewRadius : settings.radius;
   let blendColor = (settings.overviewOverride) ? settings.overviewBlendColor : settings.blendColor;
   let opacity = (settings.overviewOverride) ? settings.overviewOpacity : settings.opacity;
   let saturation = (settings.overviewOverride) ? settings.overviewSaturation : settings.saturation;

   // Get the overview's background image and add the BlurEffect to it if configured to do so
   let desktopBackground = children[0];
   if (blurType > BlurType.None) {
      let fx;
      if (blurType === BlurType.Simple) {
         fx = new Clutter.BlurEffect();
      } else if (blurType === BlurType.Gaussian || blurType === BlurType.DynamicBlur) {
         fx = new GaussianBlur.GaussianBlurEffect( { radius: radius, brightness: 1, width: 0, height: 0 } );
      } else if (blurType === BlurType.MonteCarlo || blurType === BlurType.DynamicMC) {
         fx = new MonteCarloBlur.MonteCarloBlurEffect( { radius: radius, iterations: settings.montecarloIterations, prefer_closer_pixels: settings.montecarloPerferCloserPixels, use_base_pixel: settings.montecarloUseBasePixel, brightness: 1, width: 0, height: 0 } );
      } else { // Dual-Kawase
         fx = new DualKawaseBlur.DualFilteringBlurEffect( { radius: radius, brightness: 1, width: 0, height: 0 } );
      }
      desktopBackground.add_effect_with_name( BLUR_EFFECT_NAME, fx );
   }
   if (saturation<100) {
      let desat = new Clutter.DesaturateEffect({factor: (100-saturation)/100});
      desktopBackground.add_effect_with_name( DESAT_EFFECT_NAME, desat );
   }
   // Get the overview's backgroundShade child and set it's color to see-through solid black/"Color blend" color
   let backgroundShade = children[1];
   let [ret,color] = Clutter.Color.from_string( blendColor );
   backgroundShade.set_opacity(0);
   backgroundShade.set_background_color(color);

   // Dim the backgroundShade by making the black/"Color blend" color less see-through by the configured percentage
   Tweener.addTween( backgroundShade,
      { opacity: Math.round(opacity*2.55), time: ANIMATION_TIME, transition: 'easeNone' } );
}

function _animateVisibleExpo() {
   if (this.visible || this.animationInProgress)
      return;

   this._oldAnimateVisible();
   this._gradient.hide();   // Remove the gradient so that the background image is visible

   let blurType = (settings.expoOverride) ? settings.expoBlurType : settings.blurType;
   let radius = (settings.expoOverride) ? settings.expoRadius : settings.radius;
   let blendColor = (settings.expoOverride) ? settings.expoBlendColor : settings.blendColor;
   let opacity = (settings.expoOverride) ? settings.expoOpacity : settings.opacity;
   let saturation = (settings.expoOverride) ? settings.expoSaturation : settings.saturation;

   let desktopBackground = this._background
   if (blurType > BlurType.None) {
      let fx;
      if (blurType === BlurType.Simple) {
         fx =  new Clutter.BlurEffect();
      } else if (blurType === BlurType.Gaussian || blurType === BlurType.DynamicBlur) {
         fx = new GaussianBlur.GaussianBlurEffect( {radius: radius, brightness: 1, width: 0, height: 0} );
      } else if (blurType === BlurType.MonteCarlo || blurType === BlurType.DynamicMC) {
         fx = new MonteCarloBlur.MonteCarloBlurEffect( { radius: radius, iterations: settings.montecarloIterations, prefer_closer_pixels: settings.montecarloPerferCloserPixels, use_base_pixel: settings.montecarloUseBasePixel, brightness: 1, width: 0, height: 0 } );
      } else { // Dual-Kawase
         fx = new DualKawaseBlur.DualFilteringBlurEffect( { radius: radius, brightness: 1, width: 0, height: 0 } );
      }
      desktopBackground.add_effect_with_name( BLUR_EFFECT_NAME, fx );
   }
   if (saturation<100) {
      let desat = new Clutter.DesaturateEffect({factor: (100-saturation)/100});
      desktopBackground.add_effect_with_name( DESAT_EFFECT_NAME, desat );
   }
   // Create a shade, set it's color in accordance with the settings and make it invisible
   let backgroundShade = new St.Bin({style_class: 'workspace-overview-background-shade'});
   this._backgroundShade = backgroundShade;
   backgroundShade.set_size(global.screen_width, global.screen_height);
   this._background.add_actor(backgroundShade);
   let [ret,color] = Clutter.Color.from_string( blendColor );
   backgroundShade.set_opacity(0);
   backgroundShade.set_background_color(color);
   // Dim the backgroundShade by making the black/"Color blend" color less see-through by the configured percentage
   Tweener.addTween( backgroundShade,
      { opacity: Math.round(opacity*2.55), time: ANIMATION_TIME, transition: 'easeNone' } );
}

function _showAppSwitcher3D(...params) {
   this._oldShow(...params);

   if (this._background && this.actor && settings.enableAppswitcherEffects && settings.appswitcherAllow3D) {
      let blurType = (settings.appswitcherOverride) ? settings.appswitcherBlurType : settings.blurType;
      let radius = (settings.appswitcherOverride) ? settings.appswitcherRadius : settings.radius;
      let blendColor = (settings.appswitcherOverride) ? settings.appswitcherBlendColor : settings.blendColor;
      let opacity = (settings.appswitcherOverride) ? settings.appswitcherOpacity : settings.opacity;
      let saturation = (settings.appswitcherOverride) ? settings.appswitcherSaturation : settings.saturation;

      let desktopBackground = this._background
      if (blurType > BlurType.None) {
         let fx;
         if (blurType === BlurType.Simple) {
            fx =  new Clutter.BlurEffect();
         } else if (blurType === BlurType.Gaussian || blurType === BlurType.DynamicBlur) {
            fx = new GaussianBlur.GaussianBlurEffect( {radius: radius, brightness: 1, width: 0, height: 0} );
         } else if (blurType === BlurType.MonteCarlo || blurType === BlurType.DynamicMC) {
            fx = new MonteCarloBlur.MonteCarloBlurEffect( { radius: radius, iterations: settings.montecarloIterations, prefer_closer_pixels: settings.montecarloPerferCloserPixels, use_base_pixel: settings.montecarloUseBasePixel, brightness: 1, width: 0, height: 0 } );
         } else { // Dual-Kawase
            fx = new DualKawaseBlur.DualFilteringBlurEffect( { radius: radius, brightness: 1, width: 0, height: 0 } );
         }
         desktopBackground.add_effect_with_name( BLUR_EFFECT_NAME, fx );
         this._blurCinnamonBlurEffect = fx;
      }
      if (saturation<100) {
         let desat = new Clutter.DesaturateEffect({factor: (100-saturation)/100});
         desktopBackground.add_effect_with_name( DESAT_EFFECT_NAME, desat );
         this._blurCinnamonDesatEffect = desat;
      }

      let [ret,color] = Clutter.Color.from_string( blendColor );
      if (!ret) { [ret,color] = Clutter.Color.from_string( "rgba(0,0,0,0)" ); }
      color.alpha = Math.round(opacity*2.55);
      this.actor.set_background_color(color);
   }

   // Disable all panels
   if (settings.appswitcherDisablePanels) {
      let panels = Main.getPanels();
      for ( let i=0 ; i < panels.length  ; i++ ) {
         if (panels[i])
            panels[i].disable();
      }
   }
}

function _hideAppSwitcher3D(...params) {
   if (this._background && this._blurCinnamonBlurEffect) {
      this._background.remove_effect(this._blurCinnamonBlurEffect);
   }
   if (this._background && this._blurCinnamonDesatEffect) {
      this._background.remove_effect(this._blurCinnamonDesatEffect);
   }

   // Enable all panels
   if (settings.appswitcherDisablePanels) {
      let panels = Main.getPanels();
      for ( let i=0 ; i < panels.length  ; i++ ) {
         if (panels[i]) {
            // For some reason, if we enable the panels right now the panels applets don't reappear, doing this at idle seems to solve it.
            Mainloop.idle_add( () => panels[i].enable() );
         }
      }
   }

   this._oldHide(...params);
}

function _sizeChangeWindowDoneWindowManager(cinnamonwm, actor) {
   if (actor._blurCinnamonDataWindow) {
      actor._blurCinnamonDataWindow.effectThis._setClip(actor);
   }
   if (actor._blurCinnamonDataFocusEffect) {
      actor._blurCinnamonDataFocusEffect.effectThis._setClip();
   }
   originalSizeChangeWindowDone.apply(this, [cinnamonwm, actor]);
}

// This is an implementation of Panel._panelHasOpenMenus() that will be used in pre-Cinnamon 6.4 versions
function panelHasOpenMenus() {
   return global.menuStackLength > 0;
}

function rectOverlap(aX, aY, aX2, aY2, bX, bY, bX2, bY2) {
   if (aX < bX2 && aX2 > bX && // X-axis overlap
       aY < bY2 && aY2 > bY)   // Y-axis overlap
   {
      return true;
   }
   return false;
}

// Is metawindow a above b
function isAbove(a, b) {
   if (a===b) return false;
   let windows = [a,b];
   global.display.sort_windows_by_stacking(windows);
   return windows[0] === b;
}

function getBackgroundClip(background) {
   // When a background has been wrapped in a small "viewport" actor (see
   // BlurBase._createBackgroundAndEffects's useViewport), the corner/blur/desaturate effects live on
   // the viewport instead, but background itself still carries a plain Clutter clip matching the same
   // visible rect (see _setClip()), so the fallback below still reads the right value either way.
   let effect = background.get_effect(CORNER_EFFECT_NAME);
   let clip;
   if (effect) {
      clip = effect.clip;
   } else {
      clip = background.get_clip();
   }
   return clip;
}

// Hack: To fix artifacts after painting a lower z-order clone, redraw the clone that is one higher in the z-order (the widow directly above).
// This is only needed for application window backgrounds.
function clonePainted(background, actor) {
   if (actor._blurCinnamonForcedRedraw) {
      // This paint happened because WE called queue_redraw() below, not because the window's own
      // content changed. Stop the chain here instead of forcing the next clone up as well.
      actor._blurCinnamonForcedRedraw = false;
      return;
   }
   let clones = background._blurCinnamonWinClones;
   if (!clones) {
      return;
   }
   // Use the already-maintained, already-ordered (bottom -> top) clone list instead of asking Clutter
   // for the group's full child list (which also holds the dimmer, corner-effect actor, desklet clone,
   // etc.) and linear-scanning it every single paint.
   let idx = clones.indexOf(actor);
   if (idx != -1 && idx < clones.length-1) {
      let next = clones[idx+1];
      // Skip clones that can't possibly show the artifact: if the two windows don't overlap on screen
      // there's no shared seam between them for a stale-pixel gap to appear in.
      let a = actor._metaWindow.get_buffer_rect();
      let b = next._metaWindow.get_buffer_rect();
      if (rectOverlap(a.x, a.y, a.x + a.width, a.y + a.height, b.x, b.y, b.x + b.width, b.y + b.height)) {
         //log( `paint for ${actor._metaWindow.get_title()}, queuing redraw for ${next._metaWindow.get_title()}` );
         next._blurCinnamonForcedRedraw = true;
         next.queue_redraw();
      }
   }
}

function createWindowClone(metaWindow, background, desktopOnly) {
   let owner = background._blurCinnamonMetaWindowOwner;
   if (background.is_mapped() && owner !== metaWindow && (!desktopOnly || metaWindow.get_window_type() === Meta.WindowType.DESKTOP) &&
      (!owner || owner.get_window_type() !== Meta.WindowType.DESKTOP || metaWindow.get_window_type() === Meta.WindowType.DESKTOP) ) {
      // Debugging check
      if( background._blurCinnamonWinClones.find( (element) => element._metaWindow === metaWindow) ) {
         log( `Warning! Tried to add a window clone to a background that already has a clone for that window.` );
         return;
      }
      let rect = metaWindow.get_buffer_rect();
      let compositor = metaWindow.get_compositor_private();
      // Remove any clones of the backgrounds window in metaWindow's clones. Required to avoid a recurrsion during painting.
      if (owner && compositor) {
         let blurData = compositor._blurCinnamonDataWindow;
         if (blurData && blurData.background &&  blurData.background._blurCinnamonWinClones) {
            blurData.background._blurCinnamonWinClones.forEach( (clone) => {
               if (clone._metaWindow === owner) {
                  debugMsg( `Destroying clone of background's window from metaWindow's clones` );
                  destroyWindowClone(clone, blurData.background)
               }
            });
         }
      }
      let windowClone = new Clutter.Clone({source: compositor, reactive: false, x: rect.x, y: rect.y });
      if (owner) {
         debugMsg( `Created clone ${windowClone} of ${metaWindow.get_title()}/${metaWindow.get_id()} for background ${background._blurCinnamonName} "${owner.get_title()}"/"${owner.get_wm_class()}"` );
      } else {
         debugMsg( `Created clone ${windowClone} of ${metaWindow.get_title()}/${metaWindow.get_id()} for background ${background._blurCinnamonName}` );
      }
      if (metaWindow.get_window_type() === Meta.WindowType.DESKTOP && background._blurCinnamonDeskletClone) {
         background._blurCinnamonGroup.insert_child_below(windowClone, background._blurCinnamonDeskletClone);
      } else {
         background._blurCinnamonGroup.insert_child_below(windowClone, background._blurCinnamonDimmer);
      }
      background._blurCinnamonWinClones.push(windowClone);
      windowClone._metaWindow = metaWindow;
      if (settings.windowArtifactMitigation && owner) {
         windowClone._paintEventId = windowClone.connect( "paint", (actor) => clonePainted(background, actor));
      }
      return windowClone;
   } else {
      debugMsg( "Not creating an unnecessary clone." );
   }
}

function destroyWindowClone(windowClone, background) {
   if (background._blurCinnamonMetaWindowOwner) {
      debugMsg( `Removing clone ${windowClone} of "${windowClone._metaWindow.get_title()}"/${windowClone._metaWindow.get_id()} from background ${background._blurCinnamonName} / ${background._blurCinnamonMetaWindowOwner.get_title()} with ${background._blurCinnamonWinClones.length} clones` );
   } else {
      debugMsg( `Removing clone ${windowClone} of "${windowClone._metaWindow.get_title()}"/${windowClone._metaWindow.get_id()} from background ${background._blurCinnamonName} with ${background._blurCinnamonWinClones.length} clones` );
   }
   if (windowClone._paintEventId) {
      windowClone.disconnect( windowClone._paintEventId );
      delete windowClone._paintEventId;
   }
   background._blurCinnamonGroup.remove_child(windowClone);
   windowClone.destroy();
   let idx = background._blurCinnamonWinClones.indexOf(windowClone);
   if (idx != -1 ) {
      background._blurCinnamonWinClones.splice(idx, 1);
      debugMsg( `Removed clone array element idx ${idx} leaving ${background._blurCinnamonWinClones.length} clones in the array` );
   }
}

function destroyAllWindowsClones(background) {
   debugMsg( `Removing ${background._blurCinnamonWinClones.length} window clones from background ${background}` );
   background._blurCinnamonWinClones.forEach( (windowClone) => {
      debugMsg( `Removing clone ${windowClone} of '${windowClone._metaWindow.get_title()}' from background ${background._blurCinnamonName}` );
      background._blurCinnamonGroup.remove_child(windowClone);
      //windowClone.hide();
      windowClone.destroy();
   });
   background._blurCinnamonWinClones = [];
}

// Remove clones not in the new list of clones, add clones for windows not in the existing list of clones
function applyNewCloneList(background, windowsToClone, desktopOnly) {
   // Hide all clones that are no longer needed
   let clones = background._blurCinnamonWinClones;
   clones.forEach( (clone) => {
      if (!windowsToClone.includes(clone._metaWindow)) {
         clone.hide();
      }
   });
   // Reorder and/or add any missing clones.
   windowsToClone.forEach( (metaWindow) => {
      if (background.is_mapped() && background._blurCinnamonMetaWindowOwner !== metaWindow && (!desktopOnly || metaWindow.get_window_type() === Meta.WindowType.DESKTOP)) {
         let idx = clones.findIndex( (clone) => clone._metaWindow === metaWindow );
         if (idx !==-1) {
            if (metaWindow.get_window_type() === Meta.WindowType.DESKTOP && background._blurCinnamonDeskletClone) {
               background._blurCinnamonGroup.insert_child_below(clones[idx], background._blurCinnamonDeskletClone);
            } else {
               background._blurCinnamonGroup.insert_child_below(clones[idx], background._blurCinnamonDimmer);
            }
         } else {
            createWindowClone(metaWindow, background, desktopOnly);
         }
      }
   });
   // Remove all hidden clones on idle to avoid issues (do we really need to do it at idle??)
   Mainloop.idle_add( () => {
      if (!background._blurCinnamonWinClones) {
         return;
      }
      background._blurCinnamonWinClones.forEach( (clone) => {
         if (!clone.is_visible()) {
            destroyWindowClone(clone, background);
         }
      });
   });
}

function destroyAllNonDesktopClones(background) {
   for (let i=background._blurCinnamonWinClones.length-1 ; i >= 0 ; i--) {
      let windowClone = background._blurCinnamonWinClones[i];
      if (windowClone._metaWindow.get_window_type() !== Meta.WindowType.DESKTOP) {
         debugMsg( `Removing clone ${windowClone} of '${windowClone._metaWindow.get_title()}' from background ${background._blurCinnamonName}` );
         windowClone.hide();
         windowClone.destroy();
         background._blurCinnamonWinClones.splice(i, 1);
      }
   }
}

// This function just schedules an update to the background clones.
// We don't do this work right away for a number of reasons:
// 1. There are (what I believe to be) bugs in Clutter that causes hangs and weird behavior if done immediately
// 2. The sort_windows_by_stacking() API will sort incorrectly when called from within the "notify::focus-window" event handler
function cloneWindowsForBackground(background, desktopOnly) {
   //Promise.resolve().then( () => cloneWindowsForBackgroundNow(background, desktopOnly) );
   Mainloop.idle_add( () => cloneWindowsForBackgroundNow(background, desktopOnly) );
}

// Find windows that need to be cloned for the background passed in.
// metaWindowOwner is the window that owns the background and therefore
// only windows with a z-order below that window should be included.
// If metaWindowOwner is null, all overlapping windows will be cloned.
// desktopOnly: bool, true when the background should only show desktop clones
function cloneWindowsForBackgroundNow(background, desktopOnly) {
   // addBackground() will create an empty _blurCinnamonWinClones array. If we
   // don't see that array now then the background must have been already deleted
   // so we can safely just abort this call.
   if (!background._blurCinnamonWinClones) {
      return;
   }
   let currentWs = global.workspace_manager.get_active_workspace_index();
   let [blurX, blurY, blurWidth, blurHeight] = getBackgroundClip(background);
   if (blurWidth===0 || blurHeight===0 || !background.is_mapped()) {
      debugMsg( `Blurred background is zero size or unmapped: width ${blurWidth}  height ${blurHeight}  mapped ${background.is_mapped()}` );
      return;
   }
   let blurX2 = blurX + blurWidth;
   let blurY2 = blurY + blurHeight;
   let windowsToClone = [];
   let metaWindowOwner = background._blurCinnamonMetaWindowOwner;

   // Find all windows that are visible and overlap with the passed in background
   let windows = global.get_window_actors();
   windows.forEach( (window) => {
      let metaWindow = window.get_meta_window();
      let compositor = metaWindow.get_compositor_private();
      if (metaWindow && compositor && compositor.visible && (!desktopOnly || metaWindow.get_window_type() === Meta.WindowType.DESKTOP) &&
          metaWindow.get_window_type() !== Meta.WindowType.OVERRIDE_OTHER /*&& metaWindow.get_wm_class() !== "Nemo-desktop"*/)
      {
         let winRect = metaWindow.get_buffer_rect();
         let winX = winRect.x;
         let winY = winRect.y;
         let winX2 = winRect.x + winRect.width;
         let winY2 = winRect.y + winRect.height;
         if (rectOverlap(winX, winY, winX2, winY2, blurX, blurY, blurX2, blurY2)) {
            windowsToClone.push(metaWindow);
         }
      }
   });

   // Sort the windows bye the stacking order (lowest -> highest z-order)
   windowsToClone = global.display.sort_windows_by_stacking(windowsToClone);

   // Remove owner window and all windows above it
   if (metaWindowOwner) {
      let idx = windowsToClone.findIndex( (element) => element === metaWindowOwner );
      if (idx !== -1) {
         debugMsg( `Removing windowsToClone (${windowsToClone.length}) before index ${idx}` );
         windowsToClone.splice(idx, Infinity);
      }
   }

   // Deal with the existing clones
   let clones = background._blurCinnamonWinClones;
   if (clones.length > 0) {
      // Check if we have any changes to worry about
      if (windowsToClone.length === clones.length) {
         let i=0;
         for( i=0 ; i<clones.length ; i++ ) {
            if (windowsToClone[i] !== clones[i]._metaWindow) {
               break;
            }
         }
         if (i === clones.length) {
            // No changes to the set of clones, so do nothing!
            return;
         }
      }

      // There are changes to the set of clones needed, so clear all existing clones
      destroyAllWindowsClones(background);
   }
   // Create all the needed clones
   debugMsg( `Creating ${windowsToClone.length} clones for Background of ${background._blurCinnamonName}` );
   if (metaWindowOwner) {
      debugMsg( `Window: ${metaWindowOwner.get_title()}/${metaWindowOwner.get_id()}` );
   }
   windowsToClone.forEach( (window) => createWindowClone(window, background, desktopOnly) );

   return;
}

// Manage the window clones that are attached to blurred backgrounds when Dynamic Blurring is enabled on one or more components.
// This will create and delete window clones as needed based on whether or not there is any overlap between a window and the
// blurred background clip regions. Also tracks windows as they appear, disappear or move and makes the appropriate changes
// to the window clones.
class CloneManager {

   constructor() {
      this._signalManager = new SignalManager.SignalManager(null);
      this._backgrounds = [];
      this._activeWorkspaceIdx = global.workspace_manager.get_active_workspace_index();

      this._signalManager.connect(global.screen, "window-added", (screen, metaWindow, monitor) => this._onWindowAppeared(metaWindow) );
      this._signalManager.connect(global.window_manager, "switch-workspace", () => this._updateCurrentWorkspace() );
      this._signalManager.connect(global.display, "notify::focus-window", () => this._onFocusChanged() );
      this._signalManager.connect(global, 'scale-changed', () => this._uiScaleChanged());
      this._setupWindowListeners();
   }

   _uiScaleChanged() {
      debugMsg( "UI Scale Changed" );
      this._backgrounds.forEach( (background) => destroyAllWindowsClones(background) );
      // Delay creating closes to avoid issues with an instance destroy/create sequence
      this._backgrounds.forEach( (background) => cloneWindowsForBackground(background, background._blurCinnamonDesktopOnly) );
   }

   getBackgroundCount() {
      return this._backgrounds.length;
   }

   backgroundClipChanged(background) {
      debugMsg( "Clip Changed" );
      let idx = this._backgrounds.indexOf(background);
      if (idx!==-1) {
         cloneWindowsForBackground(background, background._blurCinnamonDesktopOnly);
      }
   }

   updateArtifactMitigation() {
      debugMsg( "Update Artifact Mitigation" );
      this._backgrounds.forEach( (background) => {
         if (background._blurCinnamonMetaWindowOwner) {
            background._blurCinnamonWinClones.forEach( (windowClone) => {
               if (settings.windowArtifactMitigation && !windowClone._paintEventId) {
                  windowClone._paintEventId = windowClone.connect( "paint", (actor) => clonePainted(background, windowClone));
               } else if (!settings.windowArtifactMitigation && windowClone._paintEventId) {
                  windowClone.disconnect( windowClone._paintEventId );
                  delete windowClone._paintEventId;
               }
            });
         }
      });
   }

   addBackground(background, owner, desktopOnly) {
      let idx = this._backgrounds.indexOf(background);
      if (idx !== -1) {
         debugMsg( `Not adding existing background "${background._blurCinnamonName}"` );
         return;
      }
      if (background._blurCinnamonWinClones)
         debugMsg( `Already has clones... length ${background._blurCinnamonWinClones.length}` );
      debugMsg( `Adding background "${background}", children ${background._blurCinnamonGroup.get_n_children()}` );
      background._blurCinnamonWinClones = [];
      this._backgrounds.push(background);
      if (owner !== global.desklet_container && (!owner || owner.get_window_type() !== Meta.WindowType.DESKTOP)) {
         let deskletClone = new Clutter.Clone({source : Main.deskletContainer.actor});
         background._blurCinnamonGroup.insert_child_below(deskletClone, background._blurCinnamonDimmer);
         background._blurCinnamonDeskletClone = deskletClone;
      }
      if (owner instanceof Meta.Window) {
         background._blurCinnamonMetaWindowOwner = owner;
      } else {
         background._blurCinnamonMetaWindowOwner = null;
      }
      background._blurCinnamonDesktopOnly = desktopOnly;
      cloneWindowsForBackgroundNow(background, background._blurCinnamonDesktopOnly);
      this._signalManager.connect(background, "notify::mapped", () => this._onBackgroundMapped(background));
   }

   removeBackground(background) {
      let idx = this._backgrounds.indexOf(background);
      if (idx === -1) {
         return;
      }
      this._signalManager.disconnect( "notify::mapped", background );
      destroyAllWindowsClones(background);
      delete background._blurCinnamonWinClones;
      if (background._blurCinnamonDeskletClone) {
         background._blurCinnamonGroup.remove_child(background._blurCinnamonDeskletClone);
         background._blurCinnamonDeskletClone.destroy();
         delete background._blurCinnamonDeskletClone;
      }
      delete background._blurCinnamonMetaWindowOwner;
      delete background._blurCinnamonDesktopOnly;
      this._backgrounds.splice(idx, 1);
      debugMsg( `Removed background for "${background}"/"${background._blurCinnamonName}", group children = ${background._blurCinnamonGroup.get_n_children()}` );
   }

   isDynamicEffectActive(background) {
      let idx = this._backgrounds.indexOf(background);
      return (idx!==-1);
   }

   raiseDeskletBackground(background) {
      debugMsg( "Raising desklet background" );
      // Hide the desklet container from all backgrounds to avoid an endless loop while painting
      // The desklets are not under any backgrounds anymore since it's been raised to the top
      this._backgrounds.forEach( (background) => {
         if (background._blurCinnamonDeskletClone) {
            background._blurCinnamonDeskletClone.hide();
         }
      });
      background._blurCinnamonDesktopOnly = false;
      cloneWindowsForBackgroundNow(background, false);
   }

   lowerDeskletBackground(background) {
      debugMsg( "Lowering desklet background" );
      // Show the desklet containter for all backgrounds since the desklets are now lowered again
      this._backgrounds.forEach( (background) => {
         if (background._blurCinnamonDeskletClone) {
            background._blurCinnamonDeskletClone.show();
         }
      });
      background._blurCinnamonDesktopOnly = true;
      // We need to immediately remove clones of window for the desklet background to avoid SOF during painting
      cloneWindowsForBackgroundNow(background, background._blurCinnamonDesktopOnly);
   }

   _onBackgroundMapped(background) {
      let owner = background._blurCinnamonMetaWindowOwner;
      if (owner) {
         let compositor = owner.get_compositor_private();
         if (compositor && !compositor.visible) {
            // The background is for an application window and that window is not visible,
            // therefore this map/unmap is for some clone (i.e a Windowlist Thubmnail, Alt-Tab etc.).
            return;
         }
      }
      debugMsg( `Background ${(background.mapped)?"mapped":"unmapped"} for ${background._blurCinnamonName}` );
      if (background.mapped === true) {
         cloneWindowsForBackgroundNow(background, background._blurCinnamonDesktopOnly);
      } else {
         // An unmapped background can still be visible when a clone is shows (i.e Alt-Tab)
         destroyAllWindowsClones(background);
      }
   }

   // Globally setup window listeners, add listeners that are required, remove listeners that are no longer needed
   _setupWindowListeners() {
      let windows = global.get_window_actors();
      windows.forEach( (window) => {
         let metaWindow = window.get_meta_window();
         let compositor = metaWindow.get_compositor_private();
         if (!metaWindow._blurCinnamonVisibleEventId)
            metaWindow._blurCinnamonUnmanagedEventId = metaWindow.get_compositor_private().connect("notify::visible", () => this._visibilityChanged(metaWindow) );
         if (compositor.visible && metaWindow.get_window_type() !== Meta.WindowType.DESKTOP)
         {
            if (!metaWindow._blurCinnamonAllocEventID)
               metaWindow._blurCinnamonAllocEventID = compositor.connect("notify::allocation", () => this._allocationChanged(metaWindow) );
         } else if(metaWindow) {
            if (metaWindow._blurCinnamonAllocEventID) {
               compositor.disconnect(metaWindow._blurCinnamonAllocEventID);
               delete metaWindow._blurCinnamonAllocEventID;
            }
         }
      });
   }

   _visibilityChanged(metaWindow) {
      let compositor = metaWindow.get_compositor_private();
      if (compositor.visible) {
         debugMsg( `Window "${metaWindow.get_title()}" is visible!` );
         this._onWindowAppeared(metaWindow);
         if (compositor._blurCinnamonDataWindow) {
            blurApplications.reapplyEffects(metaWindow);
         }
      }else {
         debugMsg( `Window "${metaWindow.get_title()}" is NOT visible!` );
         this._onWindowDisappeared(metaWindow);
         if (compositor && compositor._blurCinnamonDataWindow) {
            debugMsg( "Application window has been made invisible" );
            destroyAllWindowsClones(compositor._blurCinnamonDataWindow.background);
         }
      }
   }

   _onWindowAppeared(metaWindow) {
      let compositor = metaWindow.get_compositor_private();
      let winRect = metaWindow.get_buffer_rect();
      let winX = winRect.x;
      let winY = winRect.y;
      let winX2 = winRect.x + winRect.width;
      let winY2 = winRect.y + winRect.height;
      if (!metaWindow._blurCinnamonAllocEventID)
         metaWindow._blurCinnamonAllocEventID = compositor.connect("notify::allocation", () => this._allocationChanged(metaWindow) );
      if (!metaWindow._blurCinnamonVisibleEventId) {
         metaWindow._blurCinnamonVisibleEventId = metaWindow.get_compositor_private().connect("notify::visible", () => this._visibilityChanged(metaWindow) );
      }

      debugMsg( `Checking if clones are needed for appeared window: "${metaWindow.get_title()}"` );
      this._backgrounds.forEach( (background) => {
         if (!background._blurCinnamonMetaWindowOwner || metaWindow.get_window_type() === Meta.WindowType.DESKTOP || isAbove(background._blurCinnamonMetaWindowOwner, metaWindow)) {
            let [blurX, blurY, blurWidth, blurHeight] = getBackgroundClip(background);
            let blurX2 = blurX + blurWidth;
            let blurY2 = blurY + blurHeight;
            if ( rectOverlap(winX, winY, winX2, winY2, blurX, blurY, blurX2, blurY2) )
            {
               createWindowClone(metaWindow, background, background._blurCinnamonDesktopOnly)
            }
         }
      });
   }

   _onWindowDisappeared(metaWindow) {
      let compositor = metaWindow.get_compositor_private();
      if (compositor && metaWindow._blurCinnamonAllocEventID) {
         compositor.disconnect(metaWindow._blurCinnamonAllocEventID);
         delete metaWindow._blurCinnamonAllocEventID;
      }
      // Remove windowClones for this window from each background
      this._backgrounds.forEach( (background) => {
         if (background._blurCinnamonWinClones) {
            for (let idx=background._blurCinnamonWinClones.length-1 ; idx >=0  ; idx-- ) {
               let windowClone = background._blurCinnamonWinClones[idx];
               if (windowClone._metaWindow === metaWindow) {
                  debugMsg( `Removing clone for disappeared window` );
                  destroyWindowClone(windowClone, background);
                  break;
               }
            }
         }
      });
   }

   _onFocusChanged() {
      let window = global.display.get_focus_window();
      if (!window || window.get_window_type() === Meta.WindowType.DESKTOP)
         return;
      this._backgrounds.forEach( (background) => {
         if (background._blurCinnamonMetaWindowOwner === window) {
            // This background is for the new focused window, we might need to create any number of clones for this background
            debugMsg( "Cloning windows because a blurred window has received the focus" );
            cloneWindowsForBackground(background, background._blurCinnamonDesktopOnly);
         } else {
            if (background._blurCinnamonWinClones) {
               let dimmer = background._blurCinnamonDimmer;
               let group = background._blurCinnamonGroup;
               for (let idx=background._blurCinnamonWinClones.length-1 ; idx >=0  ; idx-- ) {
                  let windowClone = background._blurCinnamonWinClones[idx];
                  if (windowClone._metaWindow === window) {
                     if (background._blurCinnamonMetaWindowOwner) {
                        // This background is for an application window, the focused window can't be in the background of any other window, so delete this clone
                        debugMsg( "Removing clone from a window background because the clone's window has the focus now" );
                        destroyWindowClone(windowClone, background);
                     } else {
                        // This background is for a non-window element (i.e panel, notification, tooltip etc), so this clone now needs to be on top of all other clones
                        debugMsg( "Moving clone to top due to focus change" );
                        group.set_child_below_sibling(windowClone, dimmer);
                     }
                     // There can only be one clone of a window in any given background, so we can break once we find a clone of the focused window
                     break;
                  }
               }
            }
         }
      });
   }

   _updateCurrentWorkspace() {
      let currentWs = global.workspace_manager.get_active_workspace_index();
      if (currentWs !== this._activeWorkspaceIdx) {
         this._activeWorkspaceIdx = currentWs;
         // After switching workspace, if a window with a blurred background is dragged off a
         // dynamic blurred panel the window will not get drawn correctly after it's clone is deleted
         // from the panels dynamic blur group. This reapplyEffect call is a workaround for this issue.
         debugMsg( `Reapplying application window effects after workspace switch from ${this._activeWorkspaceIdx} to ${currentWs}` );
         if (blurApplications) {
            blurApplications.reapplyEffects();
         }
      }
   }

   // The metaWindow has moved, so we need to move it's clones.
   // Also we check if we need to add or remove clones based on
   // the window overlap state of the new size/location of a window
   _allocationChanged(metaWindow) {
      let rect = metaWindow.get_buffer_rect();
      this._backgrounds.forEach( (background) => {
         let [blurX, blurY, blurWidth, blurHeight] = getBackgroundClip(background);
         let blurX2 = blurX + blurWidth;
         let blurY2 = blurY + blurHeight;
         let overlap = rectOverlap(rect.x, rect.y, rect.x+rect.width, rect.y+rect.height, blurX, blurY, blurX+blurWidth, blurY+blurHeight);
         let underOwner = (!background._blurCinnamonMetaWindowOwner || metaWindow.get_window_type() === Meta.WindowType.DESKTOP || isAbove(background._blurCinnamonMetaWindowOwner, metaWindow));
         let found = false;
         for (let idx=background._blurCinnamonWinClones.length-1 ; idx >= 0 ; idx-- ) {
            let windowClone = background._blurCinnamonWinClones[idx];
            if (windowClone._metaWindow === metaWindow) {
               found = true;
               if (!overlap || !underOwner) {
                  debugMsg( `Removing unneeded clone` );
                  destroyWindowClone(windowClone, background);
                  break;
               } else {
                  windowClone.x = rect.x;
                  windowClone.y = rect.y;
               }
            }
         }
         if (!found && overlap && underOwner) {
            debugMsg( `Adding clone on allocation event` );
            createWindowClone(metaWindow, background, background._blurCinnamonDesktopOnly)
         }
      });
   }

   destroy() {
      this._signalManager.disconnectAllSignals();
      this._backgrounds.forEach( (background) => {
         this.removeBackground(background);
      });
      let windows = global.get_window_actors();
      windows.forEach( (window) => {
         let metaWindow = window.get_meta_window();
         if (metaWindow._blurCinnamonAllocEventID) {
            metaWindow.get_compositor_private().disconnect(metaWindow._blurCinnamonAllocEventID);
            delete metaWindow._blurCinnamonAllocEventID;
         }
         if (metaWindow._blurCinnamonWSChangeEventID) {
            metaWindow.disconnect(metaWindow._blurCinnamonWSChangeEventID);
            delete metaWindow._blurCinnamonWSChangeEventID;
         }
      });
   }
}

class BlurBase {
   constructor() {
   }

   _getGenericSettings() {
      if (!this._supportsDynamicBlur() && (settings.blurType === BlurType.DynamicBlur || settings.blurType === BlurType.DynamicMC || settings.blurType === BlurType.DynamicDK))
         return [settings.opacity, settings.blendColor, BlurType.Gaussian, settings.radius, settings.saturation];
      return [settings.opacity, settings.blendColor, settings.blurType, settings.radius, settings.saturation];
   }

   _supportsDynamicBlur() {
      return false;
   }

   _getUniqueSettings() {
      log( "Error: Blur effect class does not implement _getUniqueSettings()!" );
   }

   _getColor(colorString, opacity) {
      let [ret,color] = Clutter.Color.from_string( colorString );
      if (!ret) { [ret,color] = Clutter.Color.from_string( "rgba(0,0,0,0)" ); }
      color.alpha = Math.round(opacity*2.55);
      return color;
   }

   // Returns [opacity, blendColor, blurType, radius, saturation]
   _getSettings(override) {
      if (override) {
         return this._getUniqueSettings();
      } else {
         return this._getGenericSettings();
      }
   }

   _isDynamicEffectActive(background) {
      if (cloneManager) {
         return cloneManager.isDynamicEffectActive(background);
      }
      return false;
   }

   _createDynamicEffect(background, owner=null, desktopOnly=false) {
      if (!cloneManager) {
         cloneManager = new CloneManager();
      }
      cloneManager.addBackground(background, owner, desktopOnly);
   }

   _destroyDynamicEffect(background) {
      if (cloneManager) {
         cloneManager.removeBackground(background);
         if (cloneManager.getBackgroundCount() === 0) {
            cloneManager.destroy();
            cloneManager = null;
         }
      }
   }

   _raiseDeskletDynamicBackground(background) {
      if (cloneManager) {
         cloneManager.raiseDeskletBackground(background);
      }
   }

   _lowerDeskletDynamicBackground(background) {
      if (cloneManager) {
         cloneManager.lowerDeskletBackground(background);
      }
   }

   // useViewport: instead of attaching the corner/blur/desaturate effects to background itself,
   // create a small "viewport" actor (an St.Group, clip_to_allocation:true) that shows a
   // Clutter.Clone of background, and attach the effects to *that* instead - background is left
   // with no effects of its own. background._blurCinnamonViewport is set to the viewport (or left
   // undefined/null when useViewport is false), for the caller to pick up. See _setClip()/
   // _updateWindowViewportEffects() for how the viewport is later positioned/resized/updated - this
   // only builds and wires it.
   //
   // customParent, when given, is a function(background, viewport) that the caller uses to parent
   // both actors itself (e.g. BlurApplications needs specific sibling indices within a window's
   // compositor actor, below the window's own real content) instead of the generic `parent`
   // add_child fallback below. Either way, parenting happens *before* any effects are attached to
   // viewport: viewport is an St.Group/St.Widget, and attaching a ShaderEffect/CornerEffect to one
   // with no path up to the stage yet triggers a "st_widget_get_theme_node ... not in the stage"
   // St-CRITICAL warning. background itself isn't an St.Widget (Meta.X11BackgroundActor/
   // Clutter.Actor), so its effects were always safe to attach before parenting, and still are here
   // when useViewport is false.
   _createBackgroundAndEffects(opacity, blendColor, blurType, radius, saturation, parent=global.overlay_group, cornerRadius=0, top=true, bottom=true, useViewport=false, customParent=null) {
      let blurEffect;
      let desatEffect;
      let cornerEffect;
      let background;
      let viewport = null;

      // Create the effects
      if (blurType === BlurType.Simple)
         blurEffect =  new Clutter.BlurEffect();
      else if (blurType === BlurType.Gaussian || blurType === BlurType.DynamicBlur)
         blurEffect = new GaussianBlur.GaussianBlurEffect( {radius: radius, brightness: 1 , width: 0, height: 0} );
      else if (blurType === BlurType.MonteCarlo || blurType === BlurType.DynamicMC)
         blurEffect = new MonteCarloBlur.MonteCarloBlurEffect( { radius: radius, iterations: settings.montecarloIterations, prefer_closer_pixels: settings.montecarloPerferCloserPixels, use_base_pixel: settings.montecarloUseBasePixel, brightness: 1, width: 0, height: 0 } );
      else if (blurType === BlurType.DualKawase || blurType === BlurType.DynamicDK)
         blurEffect = new DualKawaseBlur.DualFilteringBlurEffect( { radius: radius, brightness: 1, width: 0, height: 0 } );
      if (saturation < 100)
         desatEffect = new Clutter.DesaturateEffect({factor: (100-saturation)/100});
      if (cornerRadius>0)
         cornerEffect = new CornerEffect.CornerEffect( metaData.uuid, {radius: cornerRadius, corners_top: top, corners_bottom: bottom} );

      // Create the background actor where the effects will be applied
      if (!Meta.is_wayland_compositor() && blurType !== BlurType.Transparent) {
         background = Meta.X11BackgroundActor.new_for_display(global.display);
      } else {
         background = new Clutter.Actor({width: global.stage.width, height: global.stage.height});
      }

      // Add a dimmer child to the background so we can change the colorization and dimming of the background
      let dimmerColor = this._getColor( blendColor, opacity );
      let dimmer = new Clutter.Actor({width: background.width, height: background.height, background_color: dimmerColor});
      let group = new St.Group({clip_to_allocation: true});
      group.set_size( background.width, background.height);

      group.add_child(dimmer);
      background.add_child(group);

      // If the screen resolution changes we need to change the dimmer actor size to match
      background.connect("notify::size", () => {
         group.set_width(background.width);
         group.set_height(background.height);
         dimmer.set_width(background.width);
         dimmer.set_height(background.height);
      });
      background._blurCinnamonDimmer = dimmer;
      background._blurCinnamonGroup = group;

      let effectTarget = background;
      if (useViewport) {
         viewport = new St.Group({clip_to_allocation: true});
         let sceneClone = new Clutter.Clone({source: background, reactive: false});
         viewport.add_child(sceneClone);
         viewport._blurCinnamonSceneClone = sceneClone;
         effectTarget = viewport;
      }

      // Parent before attaching effects - see the note above the function.
      if (customParent) {
         customParent(background, viewport);
      } else if (parent) {
         parent.add_child(background);
         if (viewport) parent.add_child(viewport);
      }
      this.parent = parent;

      // Attach the effects. The cornerEffect needs to be first or else the blur effect will spill
      // over the corner effect clip bounds. All three always go on the same actor (effectTarget) -
      // background when unwrapped, viewport when useViewport.
      if (cornerEffect)
         effectTarget.add_effect_with_name( CORNER_EFFECT_NAME, cornerEffect );
      if (desatEffect)
         effectTarget.add_effect_with_name( DESAT_EFFECT_NAME, desatEffect );
      if (blurEffect)
         effectTarget.add_effect_with_name( BLUR_EFFECT_NAME, blurEffect );

      // When wrapped, viewport (fully opaque except for the transparent rounded-corner cutouts the
      // corner effect just applied) sits directly above background and is assumed to fully hide
      // background's own paint. That's true everywhere except those cutouts: background only gets a
      // plain rectangular clip (see _setClip), so without a matching mask of its own, its square,
      // un-blurred corners show straight through the transparent notches viewport's rounding leaves
      // behind. Create a second CornerEffect instance (same radius/corners_top/corners_bottom) and add
      // it to background itself so its corners get masked to the same shape - _setClip() keeps its clip
      // in sync with viewport's.
      if (useViewport && cornerRadius > 0) {
         let backgroundCornerEffect = new CornerEffect.CornerEffect( metaData.uuid, {radius: cornerRadius, corners_top: top, corners_bottom: bottom} );
         background.add_effect_with_name( CORNER_EFFECT_NAME, backgroundCornerEffect );
      }

      background.hide();
      if (viewport) viewport.hide();
      background._blurCinnamonViewport = viewport;
      return background;
   }

   _getBlurEffect(background) {
      return background.get_effect(BLUR_EFFECT_NAME);
   }

   _getDesatEffect(background) {
      return background.get_effect(DESAT_EFFECT_NAME);
   }

   _getCornerEffect(background) {
      return background.get_effect(CORNER_EFFECT_NAME);
   }

   _getDimmer(background) {
      return background._blurCinnamonDimmer;
   }

   _updateEffects(background, opacity, blendColor, blurType, radius, saturation) {
      // Setup the blur effect properly
      let curEffect = background.get_effect(BLUR_EFFECT_NAME);
      let cornerEffect = background.get_effect(CORNER_EFFECT_NAME);
      let desatEffect = background.get_effect(DESAT_EFFECT_NAME);
      let dynamicEffectActive = this._isDynamicEffectActive(background);
      // Remove any dynamic blurring if enabled
      if (dynamicEffectActive) {
         this._destroyDynamicEffect(background);
      }
      // Create the background actor and attach the corner & desat effects
      if (blurType !== BlurType.Transparent && !(background instanceof Meta.X11BackgroundActor)) {
         let dimmer = background._blurCinnamonDimmer;
         background._blurCinnamonGroup.remove_child(background._blurCinnamonDimmer);
         this.parent.remove_child(background);
         if (cornerEffect) { background.remove_effect(cornerEffect); }
         if (desatEffect) { background.remove_effect(desatEffect); }
         background.destroy();
         background = Meta.X11BackgroundActor.new_for_display(global.display);
         let group = new St.Group({clip_to_allocation: true});
         group.set_size( background.width, background.height);
         group.add_child(dimmer);
         background.add_child(group);
         background._blurCinnamonGroup = group
         background._blurCinnamonDimmer = dimmer;
         if (cornerEffect) { background.add_effect_with_name( CORNER_EFFECT_NAME, cornerEffect ); }
         if (desatEffect) { background.add_effect_with_name( DESAT_EFFECT_NAME, desatEffect ); }
         this.parent.add_child(background);
      }
      if (blurType === BlurType.None && curEffect) {
         background.remove_effect(curEffect);
      } else if (blurType === BlurType.Simple && !(curEffect instanceof Clutter.BlurEffect)) {
         if (curEffect) {
            background.remove_effect(curEffect);
         }
         let blurEffect =  new Clutter.BlurEffect();
         background.add_effect_with_name( BLUR_EFFECT_NAME, blurEffect );
      } else if ((blurType === BlurType.Gaussian || blurType === BlurType.DynamicBlur) && !(curEffect instanceof GaussianBlur.GaussianBlurEffect)) {
         if (curEffect) {
            background.remove_effect(curEffect);
         }
         let blurEffect = new GaussianBlur.GaussianBlurEffect( {radius: radius, brightness: 1, width: 0, height: 0} );
         background.add_effect_with_name( BLUR_EFFECT_NAME, blurEffect );
      } else if ((blurType === BlurType.MonteCarlo || blurType === BlurType.DynamicMC) && !(curEffect instanceof MonteCarloBlur.MonteCarloBlurEffect)) {
         if (curEffect) {
            background.remove_effect(curEffect);
         }
         let blurEffect = new MonteCarloBlur.MonteCarloBlurEffect( { radius: radius, iterations: settings.montecarloIterations, prefer_closer_pixels: settings.montecarloPerferCloserPixels, use_base_pixel: settings.montecarloUseBasePixel, brightness: 1, width: 0, height: 0 } );
         background.add_effect_with_name( BLUR_EFFECT_NAME, blurEffect );
      } else if ((blurType === BlurType.DualKawase || blurType === BlurType.DynamicDK) && !(curEffect instanceof DualKawaseBlur.DualFilteringBlurEffect)) {
         if (curEffect) {
            background.remove_effect(curEffect);
         }
         let blurEffect = new DualKawaseBlur.DualFilteringBlurEffect( { radius: radius, brightness: 1, width: 0, height: 0 } );
         background.add_effect_with_name( BLUR_EFFECT_NAME, blurEffect );
      } else if (blurType === BlurType.Transparent && background instanceof Meta.X11BackgroundActor) {
         if (curEffect) {
            background.remove_effect(curEffect);
         }
         let dimmer = background._blurCinnamonDimmer;
         background._blurCinnamonGroup.remove_child(background._blurCinnamonDimmer);
         this.parent.remove_child(background);
         if (cornerEffect) { background.remove_effect(cornerEffect); }
         if (desatEffect) { background.remove_effect(desatEffect); }
         background .destroy();
         let stageWidth = global.stage.width;
         let stageHeight = global.stage.height;
         background = new Clutter.Actor({width: stageWidth, height: stageHeight});
         background.add_actor(dimmer);
         background._blurCinnamonDimmer = dimmer;
         if (cornerEffect) { background.add_effect_with_name( CORNER_EFFECT_NAME, cornerEffect ); }
         if (desatEffect) { background.add_effect_with_name( DESAT_EFFECT_NAME, desatEffect ); }
         this.parent.add_actor(background);
      }
      // Adjust the blur effects
      if ((curEffect instanceof GaussianBlur.GaussianBlurEffect || curEffect instanceof MonteCarloBlur.MonteCarloBlurEffect || curEffect instanceof DualKawaseBlur.DualFilteringBlurEffect) && curEffect.radius != radius) {
         curEffect.radius = radius;
      }
      // If Monte Carlo, update it's settings
      if (curEffect instanceof MonteCarloBlur.MonteCarloBlurEffect) {
         curEffect.iterations = settings.montecarloIterations;
         curEffect.use_base_pixel = settings.montecarloUseBasePixel;
         curEffect.prefer_closer_pixels = settings.montecarloPerferCloserPixels;
      }
      // Setup/Adjust the desaturation effect
      curEffect = background.get_effect(DESAT_EFFECT_NAME);
      if (curEffect && saturation === 100) {
         background.remove_effect(curEffect);
      } else if (curEffect && curEffect.factor !== (100-saturation)/100) {
         curEffect.set_factor((100-saturation)/100);
      } else if (!curEffect && saturation<100) {
         let desatEffect = new Clutter.DesaturateEffect({factor: (100-saturation)/100});
         background.add_effect_with_name( DESAT_EFFECT_NAME, desatEffect );
      }
      // Setup the colorization/dimming
      let dimmerColor = this._getColor( blendColor, opacity );
      background._blurCinnamonDimmer.set_background_color(dimmerColor);
      return(background);
   }

   _updateCornerRadius(background, radius, top=true, bottom=true) {
      let ce = background.get_effect(CORNER_EFFECT_NAME);
      if (ce) {
         ce.radius = radius;
      } else {
         if (radius>0) {
            // Create the effect
            let cornerEffect = new CornerEffect.CornerEffect( metaData.uuid, {radius: radius, corners_top: top, corners_bottom: bottom} );
            // Remove all the other effects so we can add them back in the correct order (corner effect must be first)
            let desatEffect = this._getDesatEffect(background);
            if (desatEffect) background.remove_effect(desatEffect);
            let blurEffect = this._getBlurEffect(background);
            if (blurEffect) background.remove_effect(blurEffect);
            background.add_effect_with_name( CORNER_EFFECT_NAME, cornerEffect );
            if (desatEffect) background.add_effect_with_name( DESAT_EFFECT_NAME, desatEffect );
            if (blurEffect) background.add_effect_with_name( BLUR_EFFECT_NAME, blurEffect );
         }
      }
   }

   // Generic equivalent of BlurBase._updateEffects(), but for a background that's been wrapped in a
   // viewport (see _createBackgroundAndEffects's useViewport): the blur/corner/desaturate effects
   // live on viewport, not background, so _updateEffects() itself must never be called on a wrapped
   // background directly - it looks up BLUR_EFFECT_NAME etc. on the background actor it's given,
   // and finding none there (they're all on viewport instead) would make it create a *second*,
   // duplicate set of effects on background alongside viewport's real ones. This is a straight
   // promotion of BlurApplications._updateWindowViewportEffects (window-specific in name only - the
   // body never referenced anything window-specific) so every other viewport-wrapped consumer can
   // share it instead of duplicating the same logic per class.
   _updateViewportEffects(background, viewport, opacity, blendColor, blurType, radius, saturation) {
      let curEffect = this._getBlurEffect(viewport);
      if (blurType === BlurType.DynamicBlur && !(curEffect instanceof GaussianBlur.GaussianBlurEffect)) {
         if (curEffect) viewport.remove_effect(curEffect);
         viewport.add_effect_with_name( BLUR_EFFECT_NAME, new GaussianBlur.GaussianBlurEffect( {radius: radius, brightness: 1, width: 0, height: 0} ) );
      } else if (blurType === BlurType.DynamicMC && !(curEffect instanceof MonteCarloBlur.MonteCarloBlurEffect)) {
         if (curEffect) viewport.remove_effect(curEffect);
         viewport.add_effect_with_name( BLUR_EFFECT_NAME, new MonteCarloBlur.MonteCarloBlurEffect( { radius: radius, iterations: settings.montecarloIterations, prefer_closer_pixels: settings.montecarloPerferCloserPixels, use_base_pixel: settings.montecarloUseBasePixel, brightness: 1, width: 0, height: 0 } ) );
      } else if (blurType === BlurType.DynamicDK && !(curEffect instanceof DualKawaseBlur.DualFilteringBlurEffect)) {
         if (curEffect) viewport.remove_effect(curEffect);
         viewport.add_effect_with_name( BLUR_EFFECT_NAME, new DualKawaseBlur.DualFilteringBlurEffect( { radius: radius, brightness: 1, width: 0, height: 0 } ) );
      }
      curEffect = this._getBlurEffect(viewport);
      if ((curEffect instanceof GaussianBlur.GaussianBlurEffect || curEffect instanceof MonteCarloBlur.MonteCarloBlurEffect || curEffect instanceof DualKawaseBlur.DualFilteringBlurEffect) && curEffect.radius != radius) {
         curEffect.radius = radius;
      }
      if (curEffect instanceof MonteCarloBlur.MonteCarloBlurEffect) {
         curEffect.iterations = settings.montecarloIterations;
         curEffect.use_base_pixel = settings.montecarloUseBasePixel;
         curEffect.prefer_closer_pixels = settings.montecarloPerferCloserPixels;
      }

      let desatEffect = this._getDesatEffect(viewport);
      if (desatEffect && saturation === 100) {
         viewport.remove_effect(desatEffect);
      } else if (desatEffect && desatEffect.factor !== (100-saturation)/100) {
         desatEffect.set_factor((100-saturation)/100);
      } else if (!desatEffect && saturation < 100) {
         viewport.add_effect_with_name( DESAT_EFFECT_NAME, new Clutter.DesaturateEffect({factor: (100-saturation)/100}) );
      }

      let dimmerColor = this._getColor( blendColor, opacity );
      background._blurCinnamonDimmer.set_background_color(dimmerColor);
   }

   // Refreshes corner_radius/top/bottom on whichever actor(s) actually carry a corner effect for
   // this background - the wrapped viewport's real one, and (when wrapped) background's own
   // mirrored one (see _createBackgroundAndEffects) - so both stay in sync with settings changes
   // instead of the mirrored one drifting back to square. Safe to call unconditionally; a no-op
   // half when viewport is null (nothing to mirror) or when corner_radius is 0 and no corner effect
   // exists yet (_updateCornerRadius already handles that).
   _updateViewportCornerRadius(background, viewport, corner_radius, top, bottom) {
      let effectsActor = viewport || background;
      let cornerEffect = this._getCornerEffect(effectsActor);
      if (cornerEffect) {
         cornerEffect.corners_top = top;
         cornerEffect.corners_bottom = bottom;
      }
      this._updateCornerRadius(effectsActor, corner_radius, top, bottom);
      if (viewport) {
         let backgroundCornerEffect = this._getCornerEffect(background);
         if (backgroundCornerEffect) {
            backgroundCornerEffect.corners_top = top;
            backgroundCornerEffect.corners_bottom = bottom;
         }
         this._updateCornerRadius(background, corner_radius, top, bottom);
      }
   }

   // Generic viewport-aware clip/position helper for every consumer besides windows (which use
   // BlurApplications' own _setClip, since a window's background/viewport live inside that
   // window's own compositor actor and need position offsets this generic version doesn't). Every
   // other consumer parents background (and viewport, when used) directly into global.overlay_group
   // via _createBackgroundAndEffects's default `parent` fallback, so both actors already live in
   // plain global/stage coordinates - no compositor-relative translation is needed here the way
   // BlurApplications._setClip needs compositor.get_transformed_position().
   //
   // x/y/width/height is the target visible rect, in that same global/stage coordinate space.
   // background always gets a plain rectangular set_clip() to that rect (redundant when a corner
   // effect already clips it via its own shader-side `clip` uniform, but harmless. When viewport
   // is non-null (background was wrapped - see _createBackgroundAndEffects's useViewport), viewport
   // is sized/positioned to the same rect, its scene clone offset to crop the matching sub-region of
   // background, and viewport's own corner effect (if any) is clipped to the same inset formula for
   // BlurApplications uses. background's own *mirrored* corner effect (see
   // _createBackgroundAndEffects) is kept in sync either way, since _getCornerEffect(background)
   // finds it whether or not background is wrapped.
   _applyBackgroundClip(background, viewport, x, y, width, height) {
      width = Math.max(0, width);
      height = Math.max(0, height);
      background.set_clip(x, y, width, height);
      let backgroundCornerEffect = this._getCornerEffect(background);
      if (backgroundCornerEffect) {
         backgroundCornerEffect.clip = [x+2, y+2, Math.max(0, width-3), Math.max(0, height-3)];
      }
      if (viewport) {
         viewport.set_position(x, y);
         viewport.set_size(width, height);
         viewport._blurCinnamonSceneClone.set_position(-x, -y);
         let cornerEffect = this._getCornerEffect(viewport);
         if (cornerEffect) {
            cornerEffect.clip = [2, 2, Math.max(0, width-3), Math.max(0, height-3)];
         }
      }
      if (cloneManager)
         cloneManager.backgroundClipChanged(background);
   }

   // Generic viewport teardown helper for every consumer besides windows (BlurApplications does
   // this itself in _unblurWindow, with its own compositor-child removal). Callers must call this
   // (which internally strips both actors' effects first - see the reentrancy-race comment on
   // destroy() below) instead of just background.destroy()/viewport.destroy() directly, and must
   // call it *before* removing/destroying background so the effects-strip can still read
   // background._blurCinnamonViewport.
   //
   // Several subclasses (BlurOSD, BlurPanels, BlurDesklets, ...) define their own no-arg destroy()
   // for whole-manager teardown, which would silently shadow BlurBase.prototype.destroy(background)
   // if this called `this.destroy(background)` - so it calls the base class's version explicitly
   // (exactly what a subclass's own `super.destroy(background)` does) rather than through `this`.
   _destroyBackgroundAndViewport(background, parent=null) {
      let viewport = background._blurCinnamonViewport;
      BlurBase.prototype.destroy.call(this, background);
      if (viewport) {
         let viewportParent = parent || viewport.get_parent();
         if (viewportParent) viewportParent.remove_child(viewport);
         viewport.destroy();
      }
      let backgroundParent = parent || background.get_parent();
      if (backgroundParent) backgroundParent.remove_child(background);
      background.destroy();
   }

   // Whether blurType is one of the three Dynamic* types - the only types _createBackgroundAndEffects's
   // useViewport is meant for (see BlurApplications._blurWindow's own useViewport computation for the
   // full rationale: correctness for Dynamic types specifically, since only those clone windows via
   // CloneManager and so are the only ones that can hit the wallpaper-bleed bug viewport-wrapping
   // fixes - plus the same FBO-shrink GPU/CPU win as a bonus).
   _wantsViewport(blurType) {
      return blurType === BlurType.DynamicBlur || blurType === BlurType.DynamicMC || blurType === BlurType.DynamicDK;
   }

   // viewport (see _createBackgroundAndEffects's useViewport): when the caller's background was
   // wrapped, pass its viewport here too so it gets sized/positioned/clipped along with it - see
   // _applyBackgroundClip, which this now delegates to. Left null (the default), this behaves
   // exactly as before for callers that never wrap (background alone gets clipped/masked).
   _setClip(actor, background, marginsActor=null, viewport=null) {
      //printStackTrace("setClip");
      //this._printActor(actor);
      let x, y, width, height;
      if (marginsActor) {
         let themeNode = marginsActor.get_theme_node();
         let left   = themeNode.get_margin(St.Side.LEFT)   //+ themeNode.get_padding(St.Side.LEFT);
         let right  = themeNode.get_margin(St.Side.RIGHT)  //+ themeNode.get_padding(St.Side.RIGHT);
         let top    = themeNode.get_margin(St.Side.TOP)    //+ themeNode.get_padding(St.Side.TOP);
         let bottom = themeNode.get_margin(St.Side.BOTTOM) //+ themeNode.get_padding(St.Side.BOTTOM);
         //log( `Margins: ${left}, ${right}, ${top}, ${bottom}` );
         x = actor.x+left; y = actor.y+top; width = actor.width-(left+right); height = actor.height-(top+bottom);
      } else {
         x = actor.x; y = actor.y; width = actor.width; height = actor.height;
      }
      this._applyBackgroundClip(background, viewport, x, y, width, height);
   }

   destroy(background) {
      if (background._blurCinnamonDimmer) {
         background._blurCinnamonGroup.remove_child(background._blurCinnamonDimmer);
         background._blurCinnamonDimmer.destroy();
         delete background._blurCinnamonDimmer;
      }
      let effect = this._getCornerEffect(background);
      if (effect)
         background.remove_effect(effect);
      effect = this._getDesatEffect(background);
      if (effect)
         background.remove_effect(effect);
      effect = this._getBlurEffect(background);
      if (effect)
         background.remove_effect(effect);

      // When background is wrapped in a viewport (see _createBackgroundAndEffects's useViewport),
      // the corner/desat/blur effects actually live on viewport, not background - strip them from
      // viewport too, one at a time, the same way background's own effects are removed above,
      // *before* the caller destroys either actor. Callers must call this (or otherwise strip
      // viewport's effects) before destroying viewport, not after.
      let viewport = background._blurCinnamonViewport;
      if (viewport) {
         effect = this._getCornerEffect(viewport);
         if (effect)
            viewport.remove_effect(effect);
         effect = this._getDesatEffect(viewport);
         if (effect)
            viewport.remove_effect(effect);
         effect = this._getBlurEffect(viewport);
         if (effect)
            viewport.remove_effect(effect);
      }
   }

   _printActor(actor) {
      let themeNode = actor.get_theme_node();
      let margins = actor.get_margin();
      log( `Actor: ${actor} : visible: ${actor.visible}` );
      log( `  Size:    ${actor.x} ${actor.y} ${actor.width} ${actor.height}` );
      log( `  Margin:  ${themeNode.get_margin(St.Side.LEFT)} ${themeNode.get_margin(St.Side.RIGHT)} ${themeNode.get_margin(St.Side.TOP)} ${themeNode.get_margin(St.Side.BOTTOM)}` );
      log( `  Border:  ${themeNode.get_border_width(St.Side.LEFT)} ${themeNode.get_border_width(St.Side.RIGHT)} ${themeNode.get_border_width(St.Side.TOP)} ${themeNode.get_border_width(St.Side.BOTTOM)}` );
      log( `  Padding: ${themeNode.get_padding(St.Side.LEFT)} ${themeNode.get_padding(St.Side.RIGHT)} ${themeNode.get_padding(St.Side.TOP)} ${themeNode.get_padding(St.Side.BOTTOM)}` );
      log( `  Margin:  ${margins.left} ${margins.right} ${margins.top} ${margins.bottom}` );
   }
}

class BlurOSD extends BlurBase {
   constructor() {
      super();
      this._signalManager = new SignalManager.SignalManager(null);
      blurOSDThis = this; // Make "this" available to monkey patched functions

      this.has_own_show = OsdWindow.OsdWindow.prototype.hasOwnProperty('show');
      this.original_show = OsdWindow.OsdWindow.prototype.show;
      OsdWindow.OsdWindow.prototype.show = this._show;

      // 'hide' (modern) or '_hide' (legacy)
      if (typeof OsdWindow.OsdWindow.prototype.hide === 'function') {
         this.has_own_hide = OsdWindow.OsdWindow.prototype.hasOwnProperty('hide');
         this.original_hide = OsdWindow.OsdWindow.prototype.hide;
         OsdWindow.OsdWindow.prototype.hide = this._hide;
      }
      if (typeof OsdWindow.OsdWindow.prototype._hide === 'function') {
         this.has_own_old_hide = OsdWindow.OsdWindow.prototype.hasOwnProperty('_hide');
         this.original_old_hide = OsdWindow.OsdWindow.prototype._hide;
         OsdWindow.OsdWindow.prototype._hide = this._old_hide;
      }

      if (usesWorkspaceOsd) {
         this.has_own_display = WorkspaceOsd.WorkspaceOsd.prototype.hasOwnProperty('display');
         this.original_display = WorkspaceOsd.WorkspaceOsd.prototype.display;
         WorkspaceOsd.WorkspaceOsd.prototype.display = this._display;

         this.has_own_onTimeout = WorkspaceOsd.WorkspaceOsd.prototype.hasOwnProperty('_onTimeout');
         this.original_onTimeout = WorkspaceOsd.WorkspaceOsd.prototype._onTimeout;
         WorkspaceOsd.WorkspaceOsd.prototype._onTimeout = this._onTimeout;
      } else {
         this.has_own_info_show = ModalDialog.InfoOSD.prototype.hasOwnProperty('show');
         this.original_infoOSD_show = ModalDialog.InfoOSD.prototype.show;
         ModalDialog.InfoOSD.prototype.show = this._infoOSD_show;

         this.has_own_info_hide = ModalDialog.InfoOSD.prototype.hasOwnProperty('hide');
         this.original_infoOSD_hide = ModalDialog.InfoOSD.prototype.hide;
         ModalDialog.InfoOSD.prototype.hide = this._infoOSD_hide;
      }
   }

   _supportsDynamicBlur() {
      return true;
   }

   _getUniqueSettings() {
      return [settings.osdOpacity, settings.osdBlendColor, settings.osdBlurType, settings.osdRadius, settings.osdSaturation];
   }

   _show(...params) {
      let ret = blurOSDThis.original_show.call(this, ...params);
      if (settings.osdSliderEffects) {
         try { blurOSDThis._showBackground(this, this._hbox || (this.actor ? this.actor.get_first_child() : null)); } catch (e) { global.logError(e); }
      }
      return ret;
   }

   _hide(...params) {
      try { blurOSDThis._hideBackground(this, this._hbox || (this.actor ? this.actor.get_first_child() : null)); } catch (e) { global.logError(e); }
      return blurOSDThis.original_hide ? blurOSDThis.original_hide.call(this, ...params) : undefined;
   }

   _old_hide(...params) {
      try { blurOSDThis._hideBackground(this, this._hbox || (this.actor ? this.actor.get_first_child() : null)); } catch (e) { global.logError(e); }
      return blurOSDThis.original_old_hide ? blurOSDThis.original_old_hide.call(this, ...params) : undefined;
   }

   _display(...params) {
      let ret = blurOSDThis.original_display.call(this, ...params);
      if (settings.osdWorkspaceEffects) {
         try { blurOSDThis._showBackground(this, this._vbox || (this.actor ? this.actor.get_first_child() : null)); } catch (e) { global.logError(e); }
      }
      return ret;
   }

   _onTimeout(...params) {
      try { blurOSDThis._hideBackground(this, this._vbox || (this.actor ? this.actor.get_first_child() : null)); } catch (e) { global.logError(e); }
      return blurOSDThis.original_onTimeout.call(this, ...params);
   }

   _infoOSD_show(...params) {
      let ret = blurOSDThis.original_infoOSD_show.call(this, ...params);
      if (settings.osdWorkspaceEffects) {
         try { blurOSDThis._showBackground(this, this.actor ? this.actor.get_first_child() : null); } catch (e) { global.logError(e); }
      }
      return ret;
   }

   _infoOSD_hide(...params) {
      try { blurOSDThis._hideBackground(this, this.actor ? this.actor.get_first_child() : null); } catch (e) { global.logError(e); }
      return blurOSDThis.original_infoOSD_hide.call(this, ...params);
   }

   _showBackground(osd, actor) {
      if (actor && !osd._blurCinnamonBackground) {
         if (this._background) {
            this._hideBackground(this._currentOsd, this._currentActor);
         }
         this._currentOsd = osd;
         this._currentActor = actor;

         if (!actor._blurCinnamonData && settings.allowTransparentColorOSD) {
            actor._blurCinnamonData = { original_color: actor.get_background_color(), original_style: actor.get_style(),
                                      original_class: actor.get_style_class_name(), original_pseudo_class: actor.get_style_pseudo_class() };
            actor.set_style( "background-gradient-direction: vertical; background-gradient-start: transparent; " +
                             "background-gradient-end: transparent; background: transparent;" );
         } else if (!settings.allowTransparentColorOSD && actor._blurCinnamonData) { 
            actor.set_background_color(actor._blurCinnamonData.original_color);
            actor.set_style(actor._blurCinnamonData.original_style);
            actor.set_style_class_name(actor._blurCinnamonData.original_class);
            actor.set_style_pseudo_class(actor._blurCinnamonData.original_pseudo_class);
            delete actor._blurCinnamonData;
         }

         let [opacity, blendColor, blurType, radius, saturation] = this._getSettings(settings.osdOverride);
         this._blurType = blurType;
         let useViewport = this._wantsViewport(blurType);

         this._background = this._createBackgroundAndEffects(opacity, blendColor, blurType, radius, saturation, global.overlay_group, 10, true, true, useViewport);
         this._background._blurCinnamonName = "OsdWindow";
         this._viewport = this._background._blurCinnamonViewport;
         if (this._viewport) this._viewport._blurCinnamonName = "OsdWindow";
         osd._blurCinnamonBackground = this._background;

         if (blurType === BlurType.DynamicBlur || blurType === BlurType.DynamicMC || blurType === BlurType.DynamicDK) {
            this._createDynamicEffect(this._background);
         }

         let themeNode = actor.get_theme_node();
         if (themeNode) {
           let corner_radius = themeNode.get_border_radius(St.Corner.TOPLEFT);
           if (corner_radius === 9999) { corner_radius = actor.height / 2; }

           this._updateViewportCornerRadius(this._background, this._viewport, (corner_radius)/global.ui_scale, true, true);
         }

         if (osd.actor) {
             this._signalManager.connect(osd.actor, "notify::allocation", () => this._setClip(actor) );
         }
         this._signalManager.connect(actor, "notify::allocation", () => this._setClip(actor) );

         if (this._idleId) {
             Mainloop.source_remove(this._idleId);
             this._idleId = null;
         }

         this._idleId = Mainloop.idle_add(() => {
             if (this._background) {
                 this._setClip(actor);
                 this._background.show();
                 if (this._viewport) this._viewport.show();

                 // Re-clip on the next idle cycle to catch layout shifts after the first paint
                 Mainloop.idle_add(() => {
                     if (this._background) this._setClip(actor);
                 });
             }
             this._idleId = null;
         });

         this._setClip(actor);
      }
   }

   _hideBackground(osd, actor) {
      if (!this._background) return;

      if (this._idleId) {
          Mainloop.source_remove(this._idleId);
          this._idleId = null;
      }

      if (this._blurType === BlurType.DynamicBlur || this._blurType === BlurType.DynamicMC || this._blurType === BlurType.DynamicDK) {
         this._destroyDynamicEffect(this._background);
      }
      if (actor && actor._blurCinnamonData) {
         actor.set_background_color(actor._blurCinnamonData.original_color);
         actor.set_style(actor._blurCinnamonData.original_style);
         actor.set_style_class_name(actor._blurCinnamonData.original_class);
         actor.set_style_pseudo_class(actor._blurCinnamonData.original_pseudo_class);
         delete actor._blurCinnamonData;
      }
      this._signalManager.disconnectAllSignals();

      // background (and viewport, when wrapped - see _createBackgroundAndEffects's useViewport)
      // are always parented into global.overlay_group here (the parent argument passed to
      // _createBackgroundAndEffects above), so _destroyBackgroundAndViewport's parent argument
      // covers the same "usually overlay_group, defensively whatever it actually is" cases the old
      // parent-detection code here handled.
      let parent = this._background.get_parent() || global.overlay_group;
      this._destroyBackgroundAndViewport(this._background, parent);
      delete this._background;
      this._viewport = null;
      if (osd) delete osd._blurCinnamonBackground;

      this._currentOsd = null;
      this._currentActor = null;
   }

   _setClip(actor) {
      if (!actor || !this._background) return;

      let [x, y] = actor.get_transformed_position();
      let [scale_x, scale_y] = actor.get_scale(); // Get the scale of the actor
      let width = actor.width * scale_x;
      let height = actor.height * scale_y;

      this._applyBackgroundClip(this._background, this._viewport, x, y, width, height);
   }

   destroy() {
      if (this._idleId) {
         Mainloop.source_remove(this._idleId);
         this._idleId = null;
      }

      if (this._signalManager) this._signalManager.disconnectAllSignals();
     
      if (this.has_own_show) OsdWindow.OsdWindow.prototype.show = this.original_show;
      else delete OsdWindow.OsdWindow.prototype.show;

      if (this.has_own_hide) OsdWindow.OsdWindow.prototype.hide = this.original_hide;
      else if (OsdWindow.OsdWindow.prototype.hide) delete OsdWindow.OsdWindow.prototype.hide;

      if (this.has_own_old_hide) OsdWindow.OsdWindow.prototype._hide = this.original_old_hide;
      else if (OsdWindow.OsdWindow.prototype._hide) delete OsdWindow.OsdWindow.prototype._hide;

      if (usesWorkspaceOsd) {
         if (this.has_own_display) WorkspaceOsd.WorkspaceOsd.prototype.display = this.original_display;
         else delete WorkspaceOsd.WorkspaceOsd.prototype.display;

         if (this.has_own_onTimeout) WorkspaceOsd.WorkspaceOsd.prototype._onTimeout = this.original_onTimeout;
         else delete WorkspaceOsd.WorkspaceOsd.prototype._onTimeout;
      } else {
         if (this.has_own_info_show) ModalDialog.InfoOSD.prototype.show = this.original_infoOSD_show;
         else delete ModalDialog.InfoOSD.prototype.show;

         if (this.has_own_info_hide) ModalDialog.InfoOSD.prototype.hide = this.original_infoOSD_hide;
         else delete ModalDialog.InfoOSD.prototype.hide;
      }

      this._hideBackground(this._currentOsd, this._currentActor);
   }
}

class BlurClassicSwitcher extends BlurBase {
   constructor() {
      super();
      this._signalManager = new SignalManager.SignalManager(null);
      blurClassicSwitcherThis = this; // Make "this" available to monkey patched functions

      this.original_show = ClassicSwitcher.ClassicSwitcher.prototype._show;
      this.original_hide = ClassicSwitcher.ClassicSwitcher.prototype._hide;
      ClassicSwitcher.ClassicSwitcher.prototype._show = this._show;
      ClassicSwitcher.ClassicSwitcher.prototype._hide = this._hide;
   }

   _supportsDynamicBlur() {
      return true;
   }

   _getUniqueSettings() {
      return [settings.appswitcherOpacity, settings.appswitcherBlendColor, settings.appswitcherBlurType, settings.appswitcherRadius, settings.appswitcherSaturation];
   }

   // Monkey patch function. The 'this' will be for ClassicSwitcher
   _show(...params) {
      if (!this._previewEnabled)
         blurClassicSwitcherThis._showBackground(this);
      blurClassicSwitcherThis.original_show.call(this, ...params);
      if (!this._previewEnabled)
         blurClassicSwitcherThis._setClip(this._appList.actor)
   }

   _showBackground(switcher) {
      let actor = switcher._appList.actor;
      if (actor) {
         if (settings.allowTransparentColorSwitcher) {
            actor.set_style( "background-gradient-direction: vertical; background-gradient-start: transparent; " +
                             "background-gradient-end: transparent; background: transparent;" );
         }

         // Create the effects and the background actor to apply to effects to
         let [opacity, blendColor, blurType, radius, saturation] = this._getSettings(settings.appswitcherOverride);
         this._blurType = blurType
         let useViewport = this._wantsViewport(blurType);
         this._background = this._createBackgroundAndEffects(opacity, blendColor, blurType, radius, saturation, global.overlay_group, 10, true, true, useViewport);
         this._background._blurCinnamonName = "ClassicSwitcher";
         this._viewport = this._background._blurCinnamonViewport;
         if (this._viewport) this._viewport._blurCinnamonName = "ClassicSwitcher";

         let themeNode = actor.get_theme_node();
         if (themeNode) {
            // We are assuming that all corners have the same radius, hope that is true.
            let radius = themeNode.get_border_radius(St.Corner.TOPLEFT);
            this._updateViewportCornerRadius(this._background, this._viewport, (radius/*+6*/)/global.ui_scale, true, true);
         }
         this._signalManager.connect(actor, "notify::allocation", () => this._setClip(actor) );

         this._setClip(actor)
         // If Dynamic Blurring is enabled, create a workspace clone and add the clone to the background
         if (blurType === BlurType.DynamicBlur || blurType === BlurType.DynamicMC || blurType === BlurType.DynamicDK) {
            debugMsg( "Creating dynamic effect for classic app switcher" );
            this._createDynamicEffect(this._background);
         }
         this._background.show();
         if (this._viewport) this._viewport.show();
      }
   }

   // Monkey patch function. The 'this' will be for ClassicSwitcher
   _hide(...params) {
      if (!this._previewEnabled) {
         blurClassicSwitcherThis._hideBackground.call(blurClassicSwitcherThis);
      }
      blurClassicSwitcherThis.original_hide.call(this, ...params);
   }

   _hideBackground() {
      if (this._blurType === BlurType.DynamicBlur || this._blurType === BlurType.DynamicMC || this._blurType === BlurType.DynamicDK) {
         debugMsg( "Removing dynamic effect for classic app switcher" );
         this._destroyDynamicEffect(this._background);
      }
      this._signalManager.disconnectAllSignals();
      this._destroyBackgroundAndViewport(this._background, global.overlay_group);
      this._viewport = null;
   }

   _setClip(actor) {
      let [x,y] = actor.get_transformed_position();
      this._applyBackgroundClip(this._background, this._viewport, x, y, actor.width, actor.height);
   }

   destroy() {
      ClassicSwitcher.ClassicSwitcher.prototype._show = this.original_show;
      ClassicSwitcher.ClassicSwitcher.prototype._hide = this.original_hide;
      if (this._background) {
         this._destroyBackgroundAndViewport(this._background, global.overlay_group);
         this._viewport = null;
      }
   }
}

// This class manages the blurring of the panels
class BlurPanels extends BlurBase {

   constructor() {
      super();
      this._signalManager = new SignalManager.SignalManager(null);
      this._maximizeSignalManager = new SignalManager.SignalManager(null);
      this._blurredPanels = [];
      this._blurExistingPanels();

      blurPanelsThis = this; // Make the 'this' pointer available in patch functions

      // Monkey patch panel functions so we can manage the blurred backgrounds when the panels are hidden/shown
      this._originalPanelEnable    = Panel.Panel.prototype.enable;
      this._originalPanelDisable   = Panel.Panel.prototype.disable;

      Panel.Panel.prototype.enable  = this.blurEnable;
      Panel.Panel.prototype.disable = this.blurDisable;

      // Connect to events so we know if panels are added or removed
      this._signalManager.connect(global.settings,    "changed::panels-enabled", this._panel_changed, this);
      this._signalManager.connect(Main.layoutManager, "monitors-changed",        this._panel_changed, this);
      // Connect to an event that can hide the panels
      this._signalManager.connect(global.display,     "in-fullscreen-changed",   this._fullscreen_changed, this);

      this.setupMaximizeMonitoring();

      // Get notified when we resume from sleep so we can try and fix up the blurred panels
      // There has a been a report of issues after a resume
      //this._upClient = new UPowerGlib.Client();
      //log( "Blur Cinnamon: using notify::resume" );
      //this._upClient.connect('notify::resume', Lang.bind(this, this._resumeedFromSleep));
   }

   _supportsDynamicBlur() {
      return true;
   }

   setupMaximizeMonitoring() {
      if (settings.noPanelEffectsMaximized) {
         // Connect to events so we can know if there is a maximized window
         this._maximizeSignalManager.connect(global.window_manager, "size-change", this._on_window_size_change, this);
         this._maximizeSignalManager.connect(global.window_manager, "unminimize", this._on_window_unminimize, this);
         this._maximizeSignalManager.connect(global.window_manager, "minimize", this._on_window_minimize, this);
         this._maximizeSignalManager.connect(global.window_manager, "switch-workspace", this._on_workspace_switch, this);
         this._maximizeSignalManager.connect(global.window_manager, "destroy", this._on_window_removed, this);
         this._maximizeSignalManager.connect(global.screen, "window-added", this._on_window_added, this);
         //this._maximizeSignalManager.connect(global.screen, "window-monitor-changed", this.windowMonitorChanged, this);
         this._maximizeSignalManager.connect(global.screen, "window-workspace-changed", this._on_window_workspace_changed, this);
         // If there are panels to make transparent, then do it now.
         if (this._blurredPanels.length) {
            this._setupPanelTransparencyOnAllMonitors();
         }
      } else {
         // Remove all the signals for detecting maximized windows
         this._maximizeSignalManager.disconnectAllSignals();
         // Make sure all the panels are made transparent
         if (this._blurredPanels.length) {
            this._applyPanelTransparencyOnAllMonitors();
         }
      }
   }

   //_resumeedFromSleep() {
   //   log( "Blur Cinnamon: We have resumed from sleep!" );
   //}

   _on_window_workspace_changed(screen, metaWindow, metaWorkspace) {
      let workspace = global.workspace_manager.get_active_workspace();
      if (workspace === metaWorkspace) {
         if (this._windowIsMaximized(metaWindow)) {
            this._setTransparencyForEachPanelOnMonitor(metaWindow.get_monitor(), false);
         }
      } else {
         if (this._windowIsMaximized(metaWindow)) {
            this._setupPanelTransparencyOnMonitor(metaWindow.get_monitor());
         }
      }
   }

   _on_window_added(screen, metaWindow, monitor) {
      if (this._blurredPanels.length === 0) return;
      // Post an event to the end of the event queue, if we check right away we won't see this new window as maximized just yet
      Mainloop.idle_add( () => {
            if (this._windowIsMaximized(metaWindow)) {
               this._setTransparencyForEachPanelOnMonitor(monitor, false);
            }
      });
   }

   _on_window_removed(ws, win) {
      if (this._blurredPanels.length === 0) return;
      // If we removed a mizimized window, then we might need to make panels transparent
      let metaWindow = win.get_meta_window();
      let monitor = metaWindow.get_monitor();
      if (this._windowIsMaximized(metaWindow)) {
         // The removed window doesn't show up in the list of windows on this monitor any more, so it's safe to check now for all maximized windows
         this._setupPanelTransparencyOnMonitor(monitor);
      }
   }

   _on_window_size_change(wm, win, change) {
      if (this._blurredPanels.length === 0) return;

      let metaWindow = win.get_meta_window();
      let monitor = metaWindow.get_monitor();
      if (change === Meta.SizeChange.MAXIMIZE) {
         this._setTransparencyForEachPanelOnMonitor(monitor, false);
      } else if (change === Meta.SizeChange.UNMAXIMIZE || change === Meta.SizeChange.TILE) {
         this._setupPanelTransparencyOnMonitor(monitor);
      }
   }

   _on_window_minimize(wm, win) {
      if (this._blurredPanels.length === 0) return;

      let metaWindow = win.get_meta_window();
      if (metaWindow.get_maximized() === Meta.MaximizeFlags.BOTH) {
         let monitor = metaWindow.get_monitor();
         this._setupPanelTransparencyOnMonitor(monitor);
      }
   }

   _on_window_unminimize(wm, win) {
      if (this._blurredPanels.length === 0) return;

      // A window was unminimized one one monitor, so we need check for other maximized windows on that monitor and set the panels transparency for panels on that monitor
      let metaWindow = win.get_meta_window();
      if (this._windowIsMaximized(metaWindow)) {
         let monitor = metaWindow.get_monitor();
         this._setupPanelTransparencyOnMonitor(monitor);
      }
   }

   _on_workspace_switch() {
      if (this._blurredPanels.length === 0) return;

      // All the windows on all monitors have changed, so we have to check everything
      this._setupPanelTransparencyOnAllMonitors();
   }

   // A window has changed on the one monitor so we need to setup the panels transparency of panels on that monitor
   _setupPanelTransparencyOnMonitor(monitor) {
      let workspace = global.workspace_manager.get_active_workspace();
      let windows = workspace.list_windows();
      let maximizedWindows = windows.filter( (window) => {return(window.get_monitor() === monitor && this._windowIsMaximized(window));} );
      this._setTransparencyForEachPanelOnMonitor(monitor, maximizedWindows.length===0);
   }

   // Apply/Remove transparency appropriately for all blurred panels (taking maximized windows in to account)
   _setupPanelTransparencyOnAllMonitors() {
      let workspace = global.workspace_manager.get_active_workspace();
      let windows = workspace.list_windows();
      let maximizedWindows = windows.filter( (window) => this._windowIsMaximized(window) );

      // Clear the transparent flag in get blurredPanel
      this._blurredPanels.forEach( (element) => { element.transparent = undefined; } );

      if (maximizedWindows.length) {
         // Remove effects from any panel on a monitor with a maximized window
         maximizedWindows.forEach( (window) => {this._setTransparencyForEachPanelOnMonitor( window.get_monitor(), false );} );
         // Apply effects on all panels that don't have a maximized window
         this._blurredPanels.forEach( (bp) => {if (bp.transparent == undefined) this._setPanelTransparency(bp, true);} );
      } else {
         // Make sure all panels are blurred
         this._blurredPanels.forEach( (bp) => {this._setPanelTransparency(bp, true);} );
      }
   }

   // Unconditionally apply transparency to all blurred pancels
   _applyPanelTransparencyOnAllMonitors() {
      this._blurredPanels.forEach( (bp) => {this._setPanelTransparency(bp, true);} );
   }

   _windowIsMaximized(win) {
      return(!win.minimized && win.get_window_type() !== Meta.WindowType.DESKTOP && win.get_maximized() === Meta.MaximizeFlags.BOTH);
   }

   _setTransparencyForEachPanelOnMonitor(monitor, transparent) {
      this._blurredPanels.forEach( (element) =>
         {
            if (element.panel.monitorIndex === monitor) {
               this._setPanelTransparency(element, transparent);
            }
         });
   }

   // If a fullscreen window event occurs we need to hide or show the background overlay
   _fullscreen_changed() {
      let panels = Main.getPanels();
      let monitor;
      let panel;
      let background;
      let viewport;

      for ( let i=0 ; i < panels.length ; i++ ) {
         panel = panels[i];
         if (panel && panel.__blurredPanel && panel.__blurredPanel.background && !panel._hidden) {
            background = panel.__blurredPanel.background;
            viewport = panel.__blurredPanel.viewport;
            if (global.display.get_monitor_in_fullscreen(panel.monitorIndex)) {
               background.hide();
               if (viewport) viewport.hide();
            } else {
               background.show();
               if (viewport) viewport.show();
            }
         }
      }
   }

   // This function is called when some change occurred to the panel setup (i.e. number of panels or panel heights, panel locations)
   _panel_changed() {
      let panels = Main.getPanels();
      // Mark our panel metadata so we can track which panels have been removed
      this._blurredPanels.forEach( (element) => element.foundPanel = false );
      let i;
      // Check for new panels
      for ( i=0 ; i < panels.length  ; i++ ) {
         if (panels[i]) {
            if (!panels[i].__blurredPanel) {
               this._blurPanel(panels[i]);
            }
            panels[i].__blurredPanel.foundPanel = true;
         }
      }
      // Check for removed panels
      for ( i=this._blurredPanels.length-1 ; i >= 0 ; i-- ) {
         if (this._blurredPanels[i] && this._blurredPanels[i].foundPanel === false) {
            let blurredPanel = this._blurredPanels[i];
            if (blurredPanel.background) {
               // Strip effects (background's and, when wrapped, viewport's - see
               // _destroyBackgroundAndViewport) before destroying either actor, same as
               // _unblurPanel() - a bare background.destroy() here never gave a multi-pass blur
               // effect (Dual Kawase) a chance to tear its own sub-effects down cleanly first.
               this._destroyDynamicEffect(blurredPanel.background);
               this._destroyBackgroundAndViewport(blurredPanel.background, global.overlay_group);
               blurredPanel.signalManager.disconnectAllSignals();
               this._blurredPanels.splice(i,1);
            }
         }
      }
   }

   _setClip(panel){
      if (panel && panel.__blurredPanel && panel.__blurredPanel.background) {
         let actor = panel.actor;
         let background = panel.__blurredPanel.background;
         let viewport = panel.__blurredPanel.viewport;
         if (actor.is_visible()) {
            this._applyBackgroundClip(background, viewport, actor.x, actor.y, actor.width, actor.height);
         } else {
            this._applyBackgroundClip(background, viewport, 0, 0, 0, 0);
         }
         if (panel._hidden || panel._disabled || global.display.get_monitor_in_fullscreen(panel.monitorIndex)) {
            background.hide();
            if (viewport) viewport.hide();
         } else if (!background.is_visible()) {
            background.show();
            if (viewport) viewport.show();
         }
      }
   }

   // Apply the blur effects to all the existing panels
   _blurExistingPanels() {
      let panels = Main.getPanels();
      for ( let i=0 ; i < panels.length ; i++ ) {
         if (panels[i]) {
            this._blurPanel(panels[i]);
         }
      }
      // Now that we are done setting up the panels, if need be, remove the transparency when maximized windows exist
      if (settings.noPanelEffectsMaximized) {
         this._setupPanelTransparencyOnAllMonitors();
      }
   }

   // Create a new blur effect for the panel argument.
   _blurPanel(panel) {
      let topRadius = 0;
      let bottomRadius = 0;
      let cornerRadius = 0;
      let panelSettings = this._getPanelSettings(panel);
      if (!panelSettings ) return;
      let [opacity, blendColor, blurType, radius, saturation, customCSS] = panelSettings;

      let actor = panel.actor;
      let blurredPanel = panel.__blurredPanel;

      // Emulate the Cinnamon 6.4 panel._panelHasOpenMenus() function for older Cinnamon releases
      if (typeof panel._panelHasOpenMenus !== "function") {
         this.added_panelHasOpenMenus = true;
         panel._panelHasOpenMenus = panelHasOpenMenus;
      }
      if (!blurredPanel) {
         // Save the current panel setting if we don't already have the data saved
         blurredPanel = { original_color: actor.get_background_color(), original_style: actor.get_style(), original_class: actor.get_style_class_name(),
                          original_pseudo_class: actor.get_style_pseudo_class(), background: null, effect: null, panel: panel };
         panel.__blurredPanel = blurredPanel;
         this._blurredPanels.push(blurredPanel);
      }
      if (settings.allowTransparentColorPanels) {
         // Make the panel transparent
         actor.set_style( "border-image: none;  border-color: transparent;  box-shadow: 0 0 transparent; " +
                          "background-gradient-direction: vertical; background-gradient-start: transparent; " +
                          "background-gradient-end: transparent;    background: transparent; " + customCSS );
      }
      // Determine the corner radius
      let themeNode = actor.get_theme_node();
      if (themeNode) {
         // TODO: Need to be able to independently round all four corners, needs improvements to the corner effect code!
         topRadius = themeNode.get_border_radius(St.Corner.TOPLEFT);
         bottomRadius = themeNode.get_border_radius(St.Corner.BOTTOMLEFT);
         cornerRadius = Math.max(topRadius, bottomRadius);
      }

      let useViewport = this._wantsViewport(blurType);
      let background = this._createBackgroundAndEffects(opacity, blendColor, blurType, radius, saturation, global.overlay_group, cornerRadius, topRadius!==0, bottomRadius!==0, useViewport);
      background._blurCinnamonName = "Panel";
      blurredPanel.background = background;
      blurredPanel.viewport = background._blurCinnamonViewport;
      if (blurredPanel.viewport) blurredPanel.viewport._blurCinnamonName = "Panel";
      this._setClip(panel);

      if (blurType === BlurType.DynamicBlur || blurType === BlurType.DynamicMC || blurType === BlurType.DynamicDK) {
         this._createDynamicEffect(background);
      }

      blurredPanel.signalManager = new SignalManager.SignalManager(null);
      blurredPanel.signalManager.connect(actor, "notify::allocation", () => this._setClip(panel) );
      blurredPanel.signalManager.connect(actor, "enter-event", () => this._onEnterEvent(panel) );
      blurredPanel.signalManager.connect(actor, "leave-event", () => this._onLeaveEvent(panel) );
      //blurredPanel.signalManager.connect(actor, 'notify::size', () => {this._setClip(panel);} );
      //blurredPanel.signalManager.connect(actor, 'notify::position', () => {this._setClip(panel);} );

      // When the panel uses a custom size in cinnamon.css we need to wait a bit and check that the size is right.
      // I hope to find a better solution than this hack one day!
      Mainloop.timeout_add( 1500, () => this._setClip(panel) );
   }

   _onEnterEvent(panel) {
      if (settings.hoverBrightenPanels && panel) {
         //let actor = panel.actor;
         let blurredPanel = panel.__blurredPanel
         if (blurredPanel) {
            let panelSettings = this._getPanelSettings(panel);
            if (!panelSettings) return
            let [opacity, blendColor, blurType, radius, saturation, customCSS] = panelSettings;

            let dimmerColor = this._getColor( blendColor, 0 );
            blurredPanel.background._blurCinnamonDimmer.set_background_color(dimmerColor);

            // The desaturate effect lives on viewport, not background, once wrapped (see
            // _createBackgroundAndEffects's useViewport) - background itself only carries the
            // mirrored corner effect in that case, never a desat effect of its own.
            let effect = this._getDesatEffect(blurredPanel.viewport || blurredPanel.background)
            if (effect) {
               effect.set_factor(0);
            }
            //effect = this._getBlurEffect(blurredPanel.background);
            //if (effect && effect instanceof GaussianBlur.GaussianBlurEffect) {
            //   effect.radius = effect.radius+25;
            //}
         }
      }
   }

   _onLeaveEvent(panel) {
      if (settings.hoverBrightenPanels && panel) {
         //let actor = panel.actor;
         let blurredPanel = panel.__blurredPanel
         if (blurredPanel) {
            let panelSettings = this._getPanelSettings(panel);
            if (!panelSettings ) return;
            let [opacity, blendColor, blurType, radius, saturation, customCSS] = panelSettings;

            let dimmerColor = this._getColor( blendColor, opacity );
            blurredPanel.background._blurCinnamonDimmer.set_background_color(dimmerColor);

            // See the matching comment in _onEnterEvent - the desat effect lives on viewport once
            // wrapped.
            let effect = this._getDesatEffect(blurredPanel.viewport || blurredPanel.background)
            if (effect) {
               effect.set_factor((100-saturation)/100);
            }
            //effect = this._getBlurEffect(blurredPanel.background);
            //if (effect && effect instanceof GaussianBlur.GaussianBlurEffect) {
            //   effect.radius = radius;
            //}
         }
      }
   }

   // This function will restore all panels to their original state and undo the monkey patching
   destroy() {
      let panels = Main.getPanels();

      this._signalManager.disconnectAllSignals();
      this._maximizeSignalManager.disconnectAllSignals();

      // Restore the panels to their original state
      for ( let i=0 ; i < panels.length ; i++ ) {
         this._unblurPanel(panels[i]);
      }

      // Restore the original functions that we monkey patched
      Panel.Panel.prototype.enable     = this._originalPanelEnable;
      Panel.Panel.prototype.disable    = this._originalPanelDisable;
   }

   _unblurPanel(panel) {
      if (panel) {
         let actor = panel.actor;
         let blurredPanel = panel.__blurredPanel
         if (blurredPanel) {
            actor.set_background_color(blurredPanel.original_color);
            actor.set_style(blurredPanel.original_style);
            actor.set_style_class_name(blurredPanel.original_class);
            actor.set_style_pseudo_class(blurredPanel.original_pseudo_class);
            if (blurredPanel.background) {
               this._destroyDynamicEffect(blurredPanel.background);
               this._destroyBackgroundAndViewport(blurredPanel.background, global.overlay_group);
               blurredPanel.viewport = null;
            }
            if (blurredPanel.signalManager)
               blurredPanel.signalManager.disconnectAllSignals()
            // Find the index of this panels this._blurredPanels entry then remove the entry
            for ( let i=0 ; i < this._blurredPanels.length ; i++ ) {
               if (this._blurredPanels[i].panel === panel) {
                  this._blurredPanels.splice(i,1);
                  break;
               }
            }
            delete panel.__blurredPanel;
            if (this.added_panelHasOpenMenus) {
               delete panel._panelHasOpenMenus;
            }
         }
      }
   }

   // Setup the panel to be transparent or restore the panels original setup based on the 'transparent' parameter
   _setPanelTransparency(blurredPanel, transparent) {
      let panel = blurredPanel.panel
      let actor = panel.actor;
      blurredPanel.transparent = transparent;
      if (transparent) {
         if (settings.allowTransparentColorPanels) {
            let panelSettings = this._getPanelSettings(panel);
            if (!panelSettings ) return;
            let [opacity, blendColor, blurType, radius, saturation, customCSS] = panelSettings;
            // Make the panel transparent
            actor.set_style( "border-image: none;  border-color: transparent;  box-shadow: 0 0 transparent; " +
                             "background-gradient-direction: vertical; background-gradient-start: transparent; " +
                             "background-gradient-end: transparent;    background: transparent; " + customCSS);
         }
         //Mainloop.idle_add( () => { this._setClip(panel) } ); // This call to _setClip causes the blurred background to disappear for some reason.
      } else {
         actor.set_background_color(blurredPanel.original_color);
         actor.set_style(blurredPanel.original_style);
         actor.set_style_class_name(blurredPanel.original_class);
         actor.set_style_pseudo_class(blurredPanel.original_pseudo_class);
      }
   }

   // Update the effects for each panel because some change was made to the panel settings
   updateEffects() {
      let panels = Main.getPanels();
      for ( let i=0 ; i < panels.length ; i++ ) {
         if (panels[i]) {
            let panelSettings = this._getPanelSettings(panels[i]);
            if (panelSettings) {
               let [opacity, blendColor, blurType, radius, saturation, customCSS] = panelSettings;
               let blurredPanel = panels[i].__blurredPanel;
               if (blurredPanel) {
                  let wantsViewport = this._wantsViewport(blurType);
                  if (!!blurredPanel.viewport !== wantsViewport) {
                     // Whether this panel's background needs to be wrapped in a viewport (see
                     // _createBackgroundAndEffects's useViewport) has changed - rebuild rather than
                     // migrate the actor tree in place, the same way BlurApplications.updateEffects()
                     // rebuilds for the equivalent transition.
                     this._unblurPanel(panels[i]);
                     this._blurPanel(panels[i]);
                     blurredPanel = panels[i].__blurredPanel;
                  } else if (blurredPanel.viewport) {
                     this._updateViewportEffects(blurredPanel.background, blurredPanel.viewport, opacity, blendColor, blurType, radius, saturation);
                  } else {
                     blurredPanel.background = this._updateEffects(blurredPanel.background, opacity, blendColor, blurType, radius, saturation);
                  }
                  if (!settings.noPanelEffectsMaximized) {
                     this._setPanelTransparency(blurredPanel, true);
                  }
                  this._setClip(panels[i]);
                  let actor = panels[i].actor;
                  // The customeCSS might have changed, so we need to restore the defaults and reapply the changes.
                  if (settings.allowTransparentColorPanels) {
                     actor.set_style(blurredPanel.original_style);
                     actor.set_style_class_name(blurredPanel.original_class);
                     actor.set_style_pseudo_class(blurredPanel.original_pseudo_class);
                     actor.set_style( "border-image: none;  border-color: transparent;  box-shadow: 0 0 transparent; " +
                                      "background-gradient-direction: vertical; background-gradient-start: transparent; " +
                                      "background-gradient-end: transparent;    background: transparent; " + customCSS );
                  }
                  // The corner radius might have chnaged via the customCSS, so determine the corner radius
                  let themeNode = actor.get_theme_node();
                  let cornerRadius = 0;
                  let topRadius = 0;
                  let bottomRadius = 0;
                  if (themeNode) {
                     // TODO: Need to be able to independently round all four corners, needs improvements to the corner effect code!
                     topRadius = themeNode.get_border_radius(St.Corner.TOPLEFT);
                     bottomRadius = themeNode.get_border_radius(St.Corner.BOTTOMLEFT);
                     cornerRadius = Math.max(topRadius, bottomRadius);
                  }
                  this._updateViewportCornerRadius(blurredPanel.background, blurredPanel.viewport, cornerRadius, topRadius!==0, bottomRadius!==0);
               } else {
                  this._blurPanel(panels[i]);
                  blurredPanel = panels[i].__blurredPanel;
               }
               if ((blurType === BlurType.DynamicBlur || blurType === BlurType.DynamicMC || blurType === BlurType.DynamicDK) && !this._isDynamicEffectActive(blurredPanel.background)) {
                  this._createDynamicEffect(blurredPanel.background);
               }
            } else if (panels[i].__blurredPanel) {
               // No settings found to apply to this panel, so remove all effects for this panel
               this._unblurPanel(panels[i])
            }
         }
      }
      if (settings.noPanelEffectsMaximized) {
         this._setupPanelTransparencyOnAllMonitors();
      }
   }

   _getUniqueSettings() {
      return [settings.panelsOpacity, settings.panelsBlendColor, settings.panelsBlurType, settings.panelsRadius, settings.panelsSaturation];
   }

   // Determine the settings that should apply for the panel argument panel
   _getPanelSettings(panel) {
      if (settings.panelsOverride && settings.enablePanelUniqueSettings) {
         for( let i=0 ; i < settings.panelUniqueSettings.length ; i++ ) {
            let uniqueSetting = settings.panelUniqueSettings[i];
            if (uniqueSetting.enabled) {
               if (uniqueSetting.panels !== PanelLoc.All) {
                  if ( (panel.panelPosition === Panel.PanelLoc.top && uniqueSetting.panels !== PanelLoc.Top) ||
                       (panel.panelPosition === Panel.PanelLoc.bottom && uniqueSetting.panels !== PanelLoc.Bottom) ||
                       (panel.panelPosition === Panel.PanelLoc.left && uniqueSetting.panels !== PanelLoc.Left) ||
                       (panel.panelPosition === Panel.PanelLoc.right && uniqueSetting.panels !== PanelLoc.Right) )
                  {
                     continue;
                  }
               }
               if (uniqueSetting.monitors !== PanelMonitor.All) {
                  if (panel.monitorIndex !== uniqueSetting.monitors) {
                     continue;
                  }
               }
               if (uniqueSetting.override) {
                  return [uniqueSetting.opacity, uniqueSetting.color, uniqueSetting.blurtype, uniqueSetting.radius, uniqueSetting.saturation, uniqueSetting.customCSS];
               } else {
                  return [...this._getGenericSettings(), ""]
               }
            }
         }
         return null;
      } else {
         return [...this._getSettings(settings.panelsOverride), ""];
      }
   }

   // Functions that will be monkey patched over the Panel functions
   blurEnable(...params) {
      try {
         if (this.__blurredPanel && this.__blurredPanel.background && !global.display.get_monitor_in_fullscreen(this.monitorIndex) && !this._hidden) {
            // Only show the blurred background after the panel animation is almost done
            Mainloop.timeout_add((AUTOHIDE_ANIMATION_TIME * 1000)*.9, () => {
               this.__blurredPanel.background.show();
               if (this.__blurredPanel.viewport) this.__blurredPanel.viewport.show();
            });
         }
      } catch (e) {}
      blurPanelsThis._originalPanelEnable.apply(this, params);
   }

   blurDisable(...params) {
      try {
         if (this.__blurredPanel && this. __blurredPanel.background && !this._hidden) {
            // Delay 50ms before hiding the blurred background to avoid a sudden unblurring of the panel before other animations even get started
            Mainloop.timeout_add(50, () => {
               this.__blurredPanel.background.hide();
               if (this.__blurredPanel.viewport) this.__blurredPanel.viewport.hide();
            });
         }
      } catch (e) {}
      blurPanelsThis._originalPanelDisable.apply(this, params);
   }
}

class BlurPopupMenus extends BlurBase {
   constructor() {
      super();
      debugMsg( "Constructing popup menu object" );
      this._menus = [];
      blurPopupMenusThis = this; // Make "this" available to monkey patched functions
      this.original_popupmenu_open = PopupMenu.PopupMenu.prototype.open;
      PopupMenu.PopupMenu.prototype.open = this._popupMenuOpen;

      let [opacity, blendColor, blurType, radius, saturation] = this._getSettings(settings.popupOverride);

      // Setup the popup menu box color
      this._boxColor = this._getColor( "rgba(0,0,0,0)", 0/*blendColor, opacity*/ );

      let useViewport = this._wantsViewport(blurType);
      this._background = this._createBackgroundAndEffects(opacity, blendColor, blurType, radius, saturation, global.overlay_group, 10, true, true, useViewport); // Assume a corner radius of 10, it will be fixed if needed
      this._background._blurCinnamonName = "Menus";
      this._viewport = this._background._blurCinnamonViewport;
      if (this._viewport) this._viewport._blurCinnamonName = "Menus";

      // Setup the popup menu accent color
      let accentOpacity = settings.popupAccentOpacity;
      this._accentColor = this._getColor( blendColor, accentOpacity );

      this._changeCount = 0;
      debugMsg( "BlurPopupMenus initilized, actor hidden" );
   }

   _supportsDynamicBlur() {
      return true;
   }

   _getUniqueSettings() {
      return [settings.popupOpacity, settings.popupBlendColor, settings.popupBlurType, settings.popupRadius, settings.popupSaturation];
   }

   // Monkey patched over PupupMenu.open()
   _popupMenuOpen(animate) {
      if ( (settings.popupAppletMenuEffects && (this instanceof Applet.AppletPopupMenu || this instanceof Applet.AppletContextMenu)) ||
           (settings.popupPanelMenuEffects && this instanceof Panel.PanelContextMenu) ||
           (settings.popupTitleMenuEffects && this instanceof WindowMenu.WindowMenu) )
      {
         debugMsg( "Attaching to a new popup menu, _popupMenuOpen()" );
         blurPopupMenusThis._blurPopupMenu(this);
      } else {
         // If we applied effects to this menu in the past, remove the effects now
         let idx = blurPopupMenusThis._menus.indexOf(this);
         if (idx !== -1) {
            this.blurCinnamonSignalManager.disconnectAllSignals();
            delete this.blurCinnamonSignalManager;
            blurPopupMenusThis._restoreMenuStyle(this);
            blurPopupMenusThis._menus.splice( idx, 1 );
         }
      }
      blurPopupMenusThis.original_popupmenu_open.call(this, animate);
   }

   // Set the visible section of the background based on the size of the popup menu
   _setClip(menu){
      if (menu && this._currentMenu && menu === this._currentMenu) {
         let actor = menu.actor;
         if (actor.visible) {
            let themeNode = menu.actor.get_theme_node();
            let pLeft = themeNode.get_padding(St.Side.LEFT);
            let pRight = themeNode.get_padding(St.Side.RIGHT);
            let pTop = themeNode.get_padding(St.Side.TOP);
            let pBottom = themeNode.get_padding(St.Side.BOTTOM);
            let bm = menu.box.get_margin();
            this._applyBackgroundClip(this._background, this._viewport,
               actor.x+bm.left+pLeft, actor.y+bm.top+pTop,
               actor.width-(bm.left+bm.right+pLeft+pRight), actor.height-(bm.top+bm.bottom+pTop+pBottom));
         } else {
            this._applyBackgroundClip(this._background, this._viewport, 0, 0, 0, 0);
         }
      }
   }

   _onOpenStateChanged(menu, open) {
      if (open) {
         debugMsg( `Applying setting to new popup menu: ${menu}` );
         let [opacity, blendColor, blurType, radius, saturation] = this._getSettings(settings.popupOverride);

         if (settings.allowTransparentColorPopup) {
            // Has some Blur Cinnamon settings changed since we last opened this menu?
            if (menu._blurCinnamonChangeCount != this._changeCount) {
               debugMsg( "Applying new settings to menu" );
               this._reapplyMenuStyle(menu, this._boxColor);
            }
            menu._blurCinnamonChangeCount = this._changeCount;

            // Find all the accent actors and adjust their transparency and background color
            if (!menu._foundAccentActors) {
               this._findAccentActors(menu, menu.actor);
               menu._foundAccentActors=true;
            } else {
               this._reapplyAccentActorsStyle(menu);
            }

            // Adjust the menu transparency and color for the menu box if required
            if (!menu.box._blurCinnamonData) {
               this._applyActorStyle(menu.box, this._boxColor);
            }

            // The menu's rounded corners could be applied to the box or the menus actor, so we have to check both
            // We are assuming that all corners have the same radius, hope that is true.
            let themeNode = menu.box.get_theme_node();
            if (themeNode) {
               let radius = themeNode.get_border_radius(St.Corner.TOPLEFT);
               this._updateViewportCornerRadius( this._background, this._viewport, radius/global.ui_scale, true, true );
            }
            themeNode = menu.actor.get_theme_node();
            if (themeNode) {
               let radius = themeNode.get_border_radius(St.Corner.TOPLEFT);
               if (radius != 0)
                  this._updateViewportCornerRadius( this._background, this._viewport, radius/global.ui_scale, true, true );
            }

            // Since menu.actor style is reset every time anyhow, we don't need to remember it's style, but we do have to set it every time
            menu.actor.set_style(  "background-gradient-direction: vertical; background-gradient-start: transparent; " +
                                   "background-gradient-end: transparent;    background: transparent;"  );
         }

         this._currentMenu = menu;
         if (menu.animating) {
            // Make the background visible but zero size initially, let the paint signal re-clip the background as needed
            this._applyBackgroundClip(this._background, this._viewport, 0, 0, 0, 0);
         } else {
            // Use the exact same clip-rect formula _setClip() uses for every later notify::allocation update
            this._setClip(menu);
         }
         this._background.show();
         if (this._viewport) this._viewport.show();
         debugMsg( "Blurred actor is now visible" );

         // If Dynamic Blurring is enabled, create window clones and add them to the background
         if (blurType === BlurType.DynamicBlur || blurType === BlurType.DynamicMC || blurType === BlurType.DynamicDK) {
            this._createDynamicEffect(this._background);
         }

         // Now that the menu is open we need to know if new actors are added so we can check for accent elements
         menu.blurCinnamonSignalManager.connect(menu.actor, 'queue-relayout', () => {this._findAccentActors(menu, menu.actor);} );
      }
   }

   // Called when Popup method is now closed and the animation is complete!
   _onClosed(menu) {
      debugMsg( "Menu close signal" );
      this._unblurPopupMenu(menu);
   }

   _onDestroyed(menu) {
      if (this._currentMenu === menu && this._background.is_visible()) {
         // In some cases the Tween for the popupMenu close animation will not call its onComplete function
         // and therefore no "menu-animated-closed" signal which would call _onClosed().
         // In those cases we must unblur the popup menu, but the menu is already gone so we just hide the background.
         debugMsg( "Unblurring on destroy" );
         this._background.hide();
         if (this._viewport) this._viewport.hide();
      }
      if (menu.blurCinnamonSignalManager) {
         menu.blurCinnamonSignalManager.disconnectAllSignals();
      }
      let idx = this._menus.indexOf(menu);
      if (idx !== -1) {
         debugMsg( `Removing menu at index ${idx}` );
         this._menus.splice( idx, 1 );
      }
   }

   _reapplyMenuStyle(menu, color) {
      if (menu.box._blurCinnamonData) {
         this._reapplyActorChildrenStyle(menu.actor);
         // menu.box will have been detected as an accent actor, this will reset the menu.box to the correct color
         this._applyActorStyle(menu.box, color);
      }
   }

   _reapplyActorChildrenStyle(actor) {
      let children = actor.get_children();
      for (let i=0 ; i < children.length ; i++ ) {
         if (children[i]._blurCinnamonData) {
            this._applyActorStyle(children[i], this._accentColor);
         }
         this._reapplyActorChildrenStyle(children[i]);
      }
   }

   _reapplyAccentActorsStyle(menu) {
      menu._blurCinnamonAccentActors.forEach( (child) => this._applyActorStyle(child, this._accentColor) );
   }

   _applyActorStyle(actor, color) {
      let radius = 0;
      if (!actor._blurCinnamonData) {
         actor._blurCinnamonData = {original_entry_color: actor.get_background_color(), original_entry_style: actor.get_style(),
                                    original_entry_class: actor.get_style_class_name(), original_entry_pseudo_class: actor.get_style_pseudo_class()};
      } else {
         let style = actor.get_style();
         if (style.startsWith(actor._blurCinnamonData.original_entry_style) === false) {
            actor._blurCinnamonData = {original_entry_color: actor.get_background_color(), original_entry_style: actor.get_style(),
                                    original_entry_class: actor.get_style_class_name(), original_entry_pseudo_class: actor.get_style_pseudo_class()};
         }
      }

      let rgba = `rgba(${color.red}, ${color.green}, ${color.blue}, ${color.alpha/255.0})`
      actor.set_style( actor._blurCinnamonData.original_entry_style + `background-gradient-direction: vertical; background-gradient-start: ${rgba}; background-gradient-end: ${rgba};`  );
      return;
   }

   _restoreMenuStyle(menu) {
      if (menu.box._blurCinnamonData) {
         this._restoreActorStyle(menu.box);
         this._restoreActorChildrenStyle(menu.actor);
      }
   }

   _restoreActorChildrenStyle(actor) {
      let children = actor.get_children();
      for (let i=0 ; i < children.length ; i++ ) {
         if (children[i]._blurCinnamonData) {
            this._restoreActorStyle(children[i]);
         }
         this._restoreActorChildrenStyle(children[i]);
      }
   }

   _restoreActorStyle(actor) {
      let orgStyleData = actor._blurCinnamonData;
      actor.set_background_color(orgStyleData.original_entry_color);
      actor.set_style(orgStyleData.original_entry_style);
      actor.set_style_class_name(orgStyleData.original_entry_class);
      actor.set_style_pseudo_class(orgStyleData.original_entry_pseudo_class);
      delete actor._blurCinnamonData;
   }

   // Look for Popup menu accent actors
   _findAccentActors(menu, actor) {
      if (!menu._blurCinnamonAccentActors)
         menu._blurCinnamonAccentActors = []
      let children = actor.get_children();
      for (let i=0 ; i < children.length ; i++ ) {
         let child = children[i];
         if (child._blurCinnamonData === undefined) {
            if (child instanceof St.Entry) {
               debugMsg( "found new entry accent actor" );
               this._applyActorStyle(child, this._accentColor);
               menu._blurCinnamonAccentActors.push(child);
            } else if (child instanceof St.BoxLayout) {
               let styleClassName = child.get_style_class_name();
               if (styleClassName && (styleClassName == "menu-favorites-box" || styleClassName == "appmenu-sidebar")) {
                  debugMsg( `found new menu accent actor: ${styleClassName}` );
                  this._applyActorStyle(child, this._accentColor);
                  menu._blurCinnamonAccentActors.push(child);
               }
            } else if (child instanceof St.Table) {
               let name = child.get_name();
               if (name && name.indexOf("notification") !== -1) {
                  debugMsg( "found new notification accent actor" );
                  this._applyActorStyle(child, this._accentColor);
                  menu._blurCinnamonAccentActors.push(child);
               }
            } else {
               child._blurCinnamonData = null; // Used to signal that this actor is not an interesting one for future calls to this function
            }
         }
         this._findAccentActors(menu, child);
      }
   }

   _blurPopupMenu(menu) {
      if (!menu.blurCinnamonSignalManager) {
         menu.blurCinnamonSignalManager = new SignalManager.SignalManager(null);
         menu.blurCinnamonSignalManager.connect(menu, "open-state-changed", Lang.bind(this, this._onOpenStateChanged) );
         menu.blurCinnamonSignalManager.connect(menu, "menu-animated-closed", Lang.bind(this, this._onClosed) );
         menu.blurCinnamonSignalManager.connect(menu, "destroy", () => {this._onDestroyed(menu)} );
         //menu.blurCinnamonSignalManager.connect(menu.actor, 'notify::size', () => {this._setClip(menu);} );
         //menu.blurCinnamonSignalManager.connect(menu.actor, 'notify::position', () => {this._setClip(menu);} );
         menu.blurCinnamonSignalManager.connect(menu.actor, "notify::allocation", () => this._setClip(menu) );
         this._menus.push(menu);
      }
      debugMsg( "attach complete" );
   }

   _unblurPopupMenu(menu) {
      if (this._currentMenu === menu) {
         this._background.hide();
         if (this._viewport) this._viewport.hide();
         debugMsg( "blur actor hidden" );
         this._currentMenu = null;
         // In case we are using Dynamic Blur, destroy it
         this._destroyDynamicEffect(this._background);
      }
      menu.blurCinnamonSignalManager.disconnect("queue-relayout", menu.actor);
      debugMsg( "unblur complete\n" );
   }

   updateEffects() {
      debugMsg("updateEffects for popup menus" );
      this._changeCount++;

      let [opacity, blendColor, blurType, radius, saturation] = this._getSettings(settings.popupOverride);
      let accentOpacity = settings.popupAccentOpacity;

      let wantsViewport = this._wantsViewport(blurType);
      if (!!this._viewport !== wantsViewport) {
         // Whether the shared menu background needs to be wrapped in a viewport (see
         // _createBackgroundAndEffects's useViewport) has changed - rebuild rather than migrate
         // the actor tree in place, the same way BlurApplications.updateEffects() rebuilds for the
         // equivalent transition. Corner radius is rebuilt at the same default-10 the constructor
         // uses - _onOpenStateChanged() re-derives the real radius from the menu's theme node the
         // next time a menu opens, exactly as it already does after construction.
         this._destroyBackgroundAndViewport(this._background, global.overlay_group);
         this._background = this._createBackgroundAndEffects(opacity, blendColor, blurType, radius, saturation, global.overlay_group, 10, true, true, wantsViewport);
         this._background._blurCinnamonName = "Menus";
         this._viewport = this._background._blurCinnamonViewport;
         if (this._viewport) this._viewport._blurCinnamonName = "Menus";
      } else if (this._viewport) {
         this._updateViewportEffects(this._background, this._viewport, opacity, blendColor, blurType, radius, saturation);
      } else {
         this._background = this._updateEffects(this._background, opacity, blendColor, blurType, radius, saturation);
      }
      //this._setClip(this._currentMenu);
      this._background.hide();
      if (this._viewport) this._viewport.hide();

      // Update the accent dimming color
      this._accentColor = this._getColor( blendColor, accentOpacity );

      if ((blurType === BlurType.DynamicBlur || blurType === BlurType.DynamicMC || blurType === BlurType.DynamicDK) && !this._isDynamicEffectActive(this._background)) {
         this._createDynamicEffect(this._background);
      }

      // If the options to allow theme overrides is disabled, remove theme overrides
      if (!settings.allowTransparentColorPopup) {
         debugMsg( "Removing theme override for popup menus" );
         let menus = this._menus;
         if (menus) {
            for (let i=0 ; i < menus.length ; i++) {
               if (menus[i].box._blurCinnamonData) {
                  this._restoreMenuStyle(menus[i]);
               }
            }
         }
      }
   }

   destroy() {
      // Restore monkey patched PopupMenu open & close functions
      debugMsg( "Destroying Popup Menu object" );
      PopupMenu.PopupMenu.prototype.open = this.original_popupmenu_open;
      this._destroyBackgroundAndViewport(this._background, global.overlay_group);
      // Remove all data in the menus associated with blurCinnamon
      let menus = this._menus;
      if (menus) {
         for (let i=0 ; i < menus.length ; i++) {
            if (menus[i].blurCinnamonSignalManager) {
               menus[i].blurCinnamonSignalManager.disconnectAllSignals();
               delete menus[i].blurCinnamonSignalManager;
            }
            if (menus[i].box._blurCinnamonData) {
               this._restoreMenuStyle(menus[i]);
            }
         }
      }
   }
}

class BlurDesktop extends BlurBase {
   constructor() {
      super();
      this._signalManager = new SignalManager.SignalManager(null);

      let [opacity, blendColor, blurType, radius, saturation] = this._getSettings(settings.desktopOverride);

      if (blurType === BlurType.Simple)
         this._blurEffect = new Clutter.BlurEffect();
      else if (blurType === BlurType.Gaussian)
         this._blurEffect = new GaussianBlur.GaussianBlurEffect( {radius: radius, brightness: 1, width: 0, height: 0} );
      else if (blurType === BlurType.MonteCarlo)
         this._blurEffect = new MonteCarloBlur.MonteCarloBlurEffect( { radius: radius, iterations: settings.montecarloIterations, prefer_closer_pixels: settings.montecarloPerferCloserPixels, use_base_pixel: settings.montecarloUseBasePixel, brightness: 1, width: 0, height: 0 } );
      else if (blurType === BlurType.DualKawase)
         this._blurEffect = new DualKawaseBlur.DualFilteringBlurEffect( { radius: radius, brightness: 1, width: 0, height: 0 } );
      this._desatEffect = new Clutter.DesaturateEffect({ factor: (100 - saturation) / 100 });
      if (this._blurEffect)
         global.background_actor.add_effect_with_name( BLUR_EFFECT_NAME, this._blurEffect );
      global.background_actor.add_effect_with_name( DESAT_EFFECT_NAME, this._desatEffect );
      // Add a dimmer child to the background so we can change the colorization and dimming of the background
      let dimmerColor = this._getColor( blendColor, opacity );
      this._dimmer = new Clutter.Actor({x_expand: true, y_expand: true, width: global.screen_width, height: global.screen_height, background_color: dimmerColor});
      global.background_actor.add_child(this._dimmer);
      this.updateEffects();
   }

   _getUniqueSettings() {
      return [settings.desktopOpacity, settings.desktopBlendColor, settings.desktopBlurType, settings.desktopRadius, settings.desktopSaturation];
   }

   updateEffects() {
      let [opacity, blendColor, blurType, radius, saturation] = this._getSettings(settings.desktopOverride);

      this._withoutFocusSettings = {radius: radius, opacity: opacity, blendColor: blendColor, saturation: saturation};
      if (settings.desktopOverride && settings.desktopWithFocus) {
         this._withFocusSettings = {radius: settings.radius, opacity: settings.opacity, blendColor: settings.blendColor, saturation: settings.saturation};
      } else {
         this._withFocusSettings = {radius: 0, opacity: 0, blendColor: "",saturation: 100};
      }
      if (this._connected && !settings.desktopWithoutFocus) {
         this._signalManager.disconnectAllSignals();
         this._connected = false
      } else if(!this._connected && settings.desktopWithoutFocus) {
         this._signalManager.connect(global.display, "notify::focus-window", () => this._onFocusChanged());
         this._signalManager.connect(Main.layoutManager, "monitors-changed", () => this._monitorsChanged());
         this._connected = true;
      }
      let curEffect = global.background_actor.get_effect(BLUR_EFFECT_NAME);
      if (blurType === BlurType.None && curEffect) {
         global.background_actor.remove_effect(curEffect);
      } else if (blurType === BlurType.Simple && !(this._blurEffect instanceof Clutter.BlurEffect)) {
         if (curEffect) {
            global.background_actor.remove_effect(curEffect);
         }
         this._blurEffect = new Clutter.BlurEffect();
         global.background_actor.add_effect_with_name( BLUR_EFFECT_NAME, this._blurEffect );
      } else if (blurType === BlurType.Gaussian && !(this._blurEffect instanceof GaussianBlur.GaussianBlurEffect)) {
         if (curEffect) {
            global.background_actor.remove_effect(curEffect);
         }
         this._blurEffect = new GaussianBlur.GaussianBlurEffect( {radius: radius, brightness: 1, width: 0, height: 0} );
         global.background_actor.add_effect_with_name( BLUR_EFFECT_NAME, this._blurEffect );
      } else if (blurType === BlurType.MonteCarlo && !(this._blurEffect instanceof MonteCarloBlur.MonteCarloBlurEffect)) {
         if (curEffect) {
            global.background_actor.remove_effect(curEffect);
         }
         this._blurEffect = new MonteCarloBlur.MonteCarloBlurEffect( { radius: radius, iterations: settings.montecarloIterations, prefer_closer_pixels: settings.montecarloPerferCloserPixels, use_base_pixel: settings.montecarloUseBasePixel, brightness: 1, width: 0, height: 0 } );
         global.background_actor.add_effect_with_name( BLUR_EFFECT_NAME, this._blurEffect );
      } else if (blurType === BlurType.DualKawase && !(this._blurEffect instanceof DualKawaseBlur.DualFilteringBlurEffect)) {
         if (curEffect) {
            global.background_actor.remove_effect(curEffect);
         }
         this._blurEffect = new DualKawaseBlur.DualFilteringBlurEffect( { radius: radius, brightness: 1, width: 0, height: 0 } );
         global.background_actor.add_effect_with_name( BLUR_EFFECT_NAME, this._blurEffect );
      } else if (blurType !== BlurType.None && curEffect === null) {
         global.background_actor.add_effect_with_name( BLUR_EFFECT_NAME, this._blurEffect );
      }
      // Adjust the effects
      if ((this._blurEffect instanceof GaussianBlur.GaussianBlurEffect || this._blurEffect instanceof MonteCarloBlur.MonteCarloBlurEffect || this._blurEffect instanceof DualKawaseBlur.DualFilteringBlurEffect) && this._blurEffect.radius != radius) {
         this._blurEffect.radius = radius;
      }
      // If Monte Carlo, update it's settings
      if (this._blurEffect instanceof MonteCarloBlur.MonteCarloBlurEffect) {
         this._blurEffect.iterations = settings.montecarloIterations;
         this._blurEffect.use_base_pixel = settings.montecarloUseBasePixel;
         this._blurEffect.prefer_closer_pixels = settings.montecarloPerferCloserPixels;
      }
      if (this._desatEffect.factor !== (100-saturation)/100) {
         this._desatEffect.set_factor((100-saturation)/100);
      }
      let dimmerColor = this._getColor( blendColor, opacity );
      this._dimmer.set_background_color(dimmerColor);
      if (this._connected) {
         this._onFocusChanged();
      }
   }

   _onFocusChanged(){
      let window = global.display.get_focus_window();
      if (!window || window.get_window_type() === Meta.WindowType.DESKTOP) {
         if ((this._blurEffect instanceof GaussianBlur.GaussianBlurEffect || this._blurEffect instanceof MonteCarloBlur.MonteCarloBlurEffect || this._blurEffect instanceof DualKawaseBlur.DualFilteringBlurEffect) && this._blurEffect.radius != this._withFocusSettings.radius)
            this._blurEffect.radius = this._withFocusSettings.radius;
         let dimmerColor = this._getColor( this._withFocusSettings.blendColor, this._withFocusSettings.opacity );
         this._dimmer.set_background_color(dimmerColor);
         if (this._desatEffect.factor !== (100-this._withFocusSettings.saturation)/100)
            this._desatEffect.set_factor((100-this._withFocusSettings.saturation)/100);
         this._currentlyWithFocus = true;
         return;
      }
      if (this._currentlyWithFocus) {
         if ((this._blurEffect instanceof GaussianBlur.GaussianBlurEffect || this._blurEffect instanceof MonteCarloBlur.MonteCarloBlurEffect || this._blurEffect instanceof DualKawaseBlur.DualFilteringBlurEffect) && this._blurEffect.radius != this._withoutFocusSettings.radius)
            this._blurEffect.radius = this._withoutFocusSettings.radius;
         let dimmerColor = this._getColor( this._withoutFocusSettings.blendColor, this._withoutFocusSettings.opacity );
         this._dimmer.set_background_color(dimmerColor);
         if (this._desatEffect.factor !== (100-this._withoutFocusSettings.saturation)/100)
            this._desatEffect.set_factor((100-this._withoutFocusSettings.saturation)/100);
         this._currentlyWithFocus = false;
      }
   }

   _monitorsChanged() {
      debugMsg( `Monitor Changed: Scale ${global.ui_scale}, Width,Height ${global.screen_width},${global.screen_height}` );
      this._dimmer.set_width(global.screen_width);
      this._dimmer.set_height(global.screen_height);
   }

   destroy() {
      this._signalManager.disconnectAllSignals();
      let effect = global.background_actor.get_effect(BLUR_EFFECT_NAME);
      if (effect) {
         global.background_actor.remove_effect(effect);
      }
      effect = global.background_actor.get_effect(DESAT_EFFECT_NAME);
      if (effect) {
         global.background_actor.remove_effect(effect);
      }
      if (this._dimmer) {
         global.background_actor.remove_child(this._dimmer);
      }
   }
}

class BlurNotifications extends BlurBase {
   constructor() {
      super();
      this._signalManager = new SignalManager.SignalManager(null);
      this.animation_time = 0.08; // seconds
      blurNotificationsThis = this; // Make "this" available to monkey patched functions
      // Monkey patch the Notification show and hide functions
      this.original_showNotification = MessageTray.MessageTray.prototype._showNotification;
      MessageTray.MessageTray.prototype._showNotification = this._showNotification;
      this.original_hideNotification = MessageTray.MessageTray.prototype._hideNotification
      MessageTray.MessageTray.prototype._hideNotification = this._hideNotification;

      // Create the effects and the background actor to apply to effects to
      let [opacity, blendColor, blurType, radius, saturation] = this._getSettings(settings.notificationOverride);
      this._blurType = blurType;
      let useViewport = this._wantsViewport(blurType);
      this._background = this._createBackgroundAndEffects(opacity, blendColor, blurType, radius, saturation, global.overlay_group, 10, true, true, useViewport);
      this._background._blurCinnamonName = "Notifications";
      this._viewport = this._background._blurCinnamonViewport;
      if (this._viewport) this._viewport._blurCinnamonName = "Notifications";

      this._activeNotificationData = null;
      this.updateEffects();
   }

   _supportsDynamicBlur() {
      return true;
   }

   _getUniqueSettings() {
      return [settings.notificationOpacity, settings.notificationBlendColor, settings.notificationBlurType, settings.notificationRadius, settings.notificationSaturation];
   }

   updateEffects() {
      let [opacity, blendColor, blurType, radius, saturation] = this._getSettings(settings.notificationOverride);

      this._blurType = blurType;
      let wantsViewport = this._wantsViewport(blurType);
      if (!!this._viewport !== wantsViewport) {
         // Whether the shared notification background needs to be wrapped in a viewport (see
         // _createBackgroundAndEffects's useViewport) has changed - rebuild rather than migrate
         // the actor tree in place, the same way BlurApplications.updateEffects() rebuilds for the
         // equivalent transition. Corner radius is rebuilt at the same default-10 the constructor
         // uses - the block below re-derives the real radius from the notification's theme node
         // right after, exactly as it already did after construction.
         this._destroyBackgroundAndViewport(this._background, global.overlay_group);
         this._background = this._createBackgroundAndEffects(opacity, blendColor, blurType, radius, saturation, global.overlay_group, 10, true, true, wantsViewport);
         this._background._blurCinnamonName = "Notifications";
         this._viewport = this._background._blurCinnamonViewport;
         if (this._viewport) this._viewport._blurCinnamonName = "Notifications";
      } else if (this._viewport) {
         this._updateViewportEffects(this._background, this._viewport, opacity, blendColor, blurType, radius, saturation);
      } else {
         this._background = this._updateEffects(this._background, opacity, blendColor, blurType, radius, saturation);
      }

      if (this._activeNotificationData) {
         let actor = this._activeNotificationData.actor;
         let button = actor.get_child();
         let table = button.get_child();

         let themeNode = table.get_theme_node();
         if (themeNode) {
            // We are assuming that all corners have the same radius, hope that is true.
            let radius = themeNode.get_border_radius(St.Corner.TOPLEFT);
            this._updateViewportCornerRadius(this._background, this._viewport, (radius/*+6*/)/global.ui_scale, true, true);
         }
         if (settings.allowTransparentColorNotifications) {
            actor.set_style( /*"border-radius: 0px;*/ "background-gradient-direction: vertical; background-gradient-start: transparent; " +
                             "background-gradient-end: transparent; background: transparent;" );
            button.set_style( /*"border-radius: 0px;*/ "background-gradient-direction: vertical; background-gradient-start: transparent; " +
                             "background-gradient-end: transparent; background: transparent;" );
            table.set_style( /*"border-radius: 0px;*/ "background-gradient-direction: vertical; background-gradient-start: transparent; " +
                             "background-gradient-end: transparent; background: transparent;" );
         } else {
            actor.set_style( this._activeNotificationData.original_actor_style );
            button.set_style( this._activeNotificationData.original_button_style );
            table.set_style( this._activeNotificationData.original_table_style );
         }
         this._setClip(actor, this._background, table, this._viewport);
         if ((this._blurType === BlurType.DynamicBlur || this._blurType === BlurType.DynamicMC || this._blurType === BlurType.DynamicDK) && !this._isDynamicEffectActive(this._background)) {
            this._createDynamicEffect(this._background);
         }
      } else {
         this._background.hide()
         if (this._viewport) this._viewport.hide();
      }
   }

   _showNotification() {
      // Call the original function then call the function to setup the effect
      blurNotificationsThis.original_showNotification.call(this);
      blurNotificationsThis._blurNotification.call(blurNotificationsThis, this._notificationBin, this._showFullscreenNotifications);
   }

   _blurNotification(actor, showFullscreenNotifications) {
      let blendColor = (settings.notificationOverride) ? settings.notificationBlendColor : settings.blendColor;
      let opacity = (settings.notificationOverride) ? settings.notificationOpacity : settings.opacity;

      let button = actor.get_child();
      let table = button.get_child();
      //log( `Bluring the notification bin actor: ${actor}` );
      //log( `   button ${actor.get_child()}` );
      //log( `   table  ${actor.get_child().get_child()}` );
      //this._printActor(actor);
      //this._printActor(button);
      //this._printActor(table);


      if (actor.visible) {
         let themeNode = table.get_theme_node();
         if (themeNode) {
            // We are assuming that all corners have the same radius, hope that is true.
            let radius = themeNode.get_border_radius(St.Corner.TOPLEFT);
            this._updateViewportCornerRadius(this._background, this._viewport, (radius/*+6*/)/global.ui_scale, true, true);
         }
         if (settings.allowTransparentColorNotifications) {
            // Save the current settings so we can restore it if need be.
            this._activeNotificationData = {actor: actor, original_actor_style: actor.get_style(),
                                            original_button_style: button.get_style(), original_table_style: table.get_style()};

            actor.set_style( /*"border-radius: 0px;*/ "background-gradient-direction: vertical; background-gradient-start: transparent; " +
                             "background-gradient-end: transparent; background: transparent;" );
            button.set_style( /*"border-radius: 0px;*/ "background-gradient-direction: vertical; background-gradient-start: transparent; " +
                             "background-gradient-end: transparent; background: transparent;" );
            table.set_style( /*"border-radius: 0px;*/ "background-gradient-direction: vertical; background-gradient-start: transparent; " +
                             "background-gradient-end: transparent; background: transparent;" );
         }
      }
      // Resize the background to match the size of the notification window
      this._setClip(actor, this._background, table, this._viewport);
      // If Dynamic Blurring is enabled, create a workspace clone and add the clone to the background
      if (this._blurType === BlurType.DynamicBlur || this._blurType === BlurType.DynamicMC || this._blurType === BlurType.DynamicDK) {
         this._createDynamicEffect(this._background);
      }
      // The notification window size can change after being shown, so we need to adjust the background when that happens
      this._signalManager.connect(actor, "notify::allocation", () => this._setClip(actor, this._background, table, this._viewport) );
      if (!showFullscreenNotifications) {
         this._signalManager.connect(global.display, "in-fullscreen-changed", this._fullscreen_changed, this);
      }
      let monitor = Main.layoutManager.findMonitorForActor(this._background);
      let idx = Main.layoutManager.monitors.indexOf(monitor);
      if (showFullscreenNotifications || !global.display.get_monitor_in_fullscreen(idx)) {
         // Delay showing the blurred background until the notification tween is well underway.
         Mainloop.timeout_add(this.animation_time * 1000, () => { this._background.show(); if (this._viewport) this._viewport.show(); } );
      }
   }

   _fullscreen_changed() {
      let monitor = Main.layoutManager.findMonitorForActor(this._background);
      let idx = Main.layoutManager.monitors.indexOf(monitor);
      if (global.display.get_monitor_in_fullscreen(idx)) {
         this._background.hide()
         if (this._viewport) this._viewport.hide();
      } else {
         this._background.show()
         if (this._viewport) this._viewport.show();
      }
   }

   _hideNotification() {
      blurNotificationsThis._destroyDynamicEffect(blurNotificationsThis._background);
      blurNotificationsThis._activeNotificationData = null;
      blurNotificationsThis._signalManager.disconnectAllSignals();
      blurNotificationsThis._background.hide();
      if (blurNotificationsThis._viewport) blurNotificationsThis._viewport.hide();
      blurNotificationsThis.original_hideNotification.call(this);
   }

   destroy() {
      // If there is an active notification, then restore it's original visual settings
      if (this._activeNotificationData) {
         let actor = this._activeNotificationData.actor;
         let button = actor.get_child();
         let table = button.get_child();
         actor.set_style( this._activeNotificationData.original_actor_style );
         button.set_style( this._activeNotificationData.original_button_style );
         table.set_style( this._activeNotificationData.original_table_style );
      }
      this._signalManager.disconnectAllSignals();
      this._background.hide();
      if (this._viewport) this._viewport.hide();

      // Restore monkey patched functions and destroy the _background
      MessageTray.MessageTray.prototype._showNotification = this.original_showNotification;
      MessageTray.MessageTray.prototype._hideNotification = this.original_hideNotification;
      this._destroyBackgroundAndViewport(this._background, global.overlay_group);
   }
}

class BlurTooltips extends BlurBase {
   constructor() {
      super();
      this._signalManager = new SignalManager.SignalManager(null);
      blurTooltipsThis = this; // Make "this" available to monkey patched functions

      // Monkey patch the Tooltip show and hide functions
      this.original_PanelItemTooltip_show = Tooltips.PanelItemTooltip.prototype.show;
      Tooltips.PanelItemTooltip.prototype.show = this._show_PanelItemTooltip;
      this.original_Tooltip_hide = Tooltips.Tooltip.prototype.hide;
      Tooltips.Tooltip.prototype.hide = this._hide_Tooltip;

      let [opacity, blendColor, blurType, radius, saturation] = this._getSettings(settings.tooltipsOverride);
      let useViewport = this._wantsViewport(blurType);
      this._background = this._createBackgroundAndEffects(opacity, blendColor, blurType, radius, saturation, global.overlay_group, 10, true, true, useViewport);
      this._background._blurCinnamonName = "Tooltips";
      this._viewport = this._background._blurCinnamonViewport;
      if (this._viewport) this._viewport._blurCinnamonName = "Tooltips";
   }

   _supportsDynamicBlur() {
      return true;
   }

   _getUniqueSettings() {
      return [settings.tooltipOpacity, settings.tooltipBlendColor, settings.tooltipBlurType, settings.tooltipRadius, settings.tooltipSaturation];
   }

   _blurTooltip(actor) {
      let [opacity, blendColor, blurType, radius, saturation] = this._getSettings(settings.tooltipsOverride);
      // Settings are re-read fresh on every show (tooltips are ephemeral, unlike the classes with a
      // live updateEffects() dispatcher), so a blur-type change since the last show is handled right
      // here: rebuild rather than migrate the actor tree in place whenever whether this background
      // needs to be wrapped in a viewport (see _createBackgroundAndEffects's useViewport) changes.
      let wantsViewport = this._wantsViewport(blurType);
      if (!!this._viewport !== wantsViewport) {
         this._destroyBackgroundAndViewport(this._background, global.overlay_group);
         this._background = this._createBackgroundAndEffects(opacity, blendColor, blurType, radius, saturation, global.overlay_group, 10, true, true, wantsViewport);
         this._background._blurCinnamonName = "Tooltips";
         this._viewport = this._background._blurCinnamonViewport;
         if (this._viewport) this._viewport._blurCinnamonName = "Tooltips";
      } else if (this._viewport) {
         this._updateViewportEffects(this._background, this._viewport, opacity, blendColor, blurType, radius, saturation);
      } else {
         this._background = this._updateEffects(this._background, opacity, blendColor, blurType, radius, saturation);
      }
      this._background.hide();
      if (this._viewport) this._viewport.hide();
      // Make the tooltip transparent and remove the rounded corners
      this._originalStyle = actor.get_style();

      let themeNode = actor.get_theme_node();
      if (themeNode) {
         // We are assuming that all corners have the same radius, hope that is true.
         let radius = themeNode.get_border_radius(St.Corner.TOPLEFT);
         this._updateViewportCornerRadius(this._background, this._viewport, (radius/*+6*/)/global.ui_scale, true, true);
      }

      if (settings.allowTransparentColorTooltips) {
         actor.set_style(  "background-gradient-direction: vertical; background-gradient-start: transparent; " +
                           "background-gradient-end: transparent;    background: transparent;"  );
      }
      // Track the showing tooltip actor so we know which hide call to react to
      this._tooltipActor = actor;
      // Clip the background subtracting the actors margins since in some cases not doing so makes the background too large
      this._setClip(actor, this._background, actor, this._viewport);
      this._background.show();
      if (this._viewport) this._viewport.show();
      // If Dynamic Blurring is enabled, create a workspace clone and add the clone to the background
      if ((blurType === BlurType.DynamicBlur || blurType === BlurType.DynamicMC || blurType === BlurType.DynamicDK) && !this._isDynamicEffectActive(this._background)) {
         this._createDynamicEffect(this._background);
      }
      // Adapt to any future tooltip size changes
      //this._signalManager.connect(actor, 'notify::size', () => {this._setClip(actor);} );
      this._signalManager.connect(actor, "notify::allocation", () => this._setClip(actor, this._background, null, this._viewport) );

      // When idle, make sure the clip is set right, sometimes it's wrong on the outset
      Mainloop.idle_add( () => {
         this._setClip(actor, this._background, null, this._viewport);
         // Try one more time
         Mainloop.idle_add( () => {this._setClip(actor, this._background, null, this._viewport);} );
         });
   }

   _unblurTooltip(actor) {
      if (actor === this._tooltipActor) {
         // In case we are using Dynamic effect, destroy it
         this._destroyDynamicEffect(this._background);
         this._background.hide();
         if (this._viewport) this._viewport.hide();
         this._signalManager.disconnectAllSignals();
         this._tooltipActor.set_style( this._originalStyle );
         this._tooltipActor = null;
      }
   }

   _show_PanelItemTooltip() {
      blurTooltipsThis.original_PanelItemTooltip_show.call(this);
      if (this._tooltip.visible) {
         blurTooltipsThis._blurTooltip.call(blurTooltipsThis, this._tooltip);
      }
   }

   _hide_Tooltip() {
      blurTooltipsThis._unblurTooltip.call(blurTooltipsThis, this._tooltip);
      blurTooltipsThis.original_Tooltip_hide.call(this);
   }

   destroy() {
      // Undo Monkey patching the Tooltip show and hide functions
      Tooltips.PanelItemTooltip.prototype.show = this.original_PanelItemTooltip_show;
      Tooltips.Tooltip.prototype.hide = this.original_Tooltip_hide;

      this._signalManager.disconnectAllSignals();
      this._background.hide();
      if (this._viewport) this._viewport.hide();
      this._destroyBackgroundAndViewport(this._background, global.overlay_group);
   }
}

class BlurApplications extends BlurBase {
   constructor() {
      super();
      // BlurApplication global listeners
      this._signalManager = new SignalManager.SignalManager(null);
      this._signalManager.connect(global.screen, "window-added", this._windowAdded, this);
      this._signalManager.connect(global.display, "notify::focus-window", this._onFocusChanged, this);
      this._signalManager.connect(global.display, "grab-op-begin", this._onWindowGrabbed, this);

      // WindowTracker so we can map windows to application
      this._windowTracker = Cinnamon.WindowTracker.get_default();

      // Add a "Default window settings" if one does not exist
      let element = settings.windowInclusionList.find( (element) => {if (element.application == _("Default window settings")) {return true;}} );
      if (!element) {
         let windowList = settings.settings.getValue("windows-inclusion-list");
         windowList.splice( 0, 0, {enabled:false, application:_("Default window settings"), override: false, opacity:0, color:"rgb(0,0,0)", blurtype:BlurType.Gaussian, radius:10, saturation:100, corner_radius: 8, corner_top: true, corner_bottom: false  } );
         settings.settings.setValue("windows-inclusion-list", windowList);
      }

      // Check existing windows to see if any need to be blurred
      let windows = global.display.list_windows(0);
      for (let i = 0; i < windows.length; i++) {
         this._blurWindow(windows[i]);
      }
   }

   _supportsDynamicBlur() {
      return true;
   }

   _onWindowGrabbed(display, screen, window, op) {
      if (op !== Meta.GrabOp.MOVING) {
         return;
      }
      let compositor = (window) ? window.get_compositor_private() : null;
      if (compositor && compositor._blurCinnamonDataWindow) {
         let compizMitigation = settings.settings.getValue("windows-compiz-mitigation");
         if (compizMitigation) {
            let effect = compositor.get_effect('wobbly-compiz-effect');
            if (effect) {
               effect.on_end_event(compositor);
            } else {
               // Give the "Compiz windows effect" time to attach the effect, then we disable the effect if the Compiz effect is active.
               Mainloop.idle_add( () => {
                  let effect = compositor.get_effect('wobbly-compiz-effect');
                  if (effect) {
                     effect.on_end_event(compositor);
                  }
               });
            }
         }
      }
   }

   _windowAdded(workspace, metaWindow) {
      this._blurWindow(metaWindow);
   }

   _blurWindow(metaWindow) {
      // Get the windows compositor actor
      let compositor = metaWindow.get_compositor_private();

      // Get the effect setting that should apply to Application windows
      let [enabled, window_opacity, opacity, blendColor, blurType, radius, saturation, corner_radius, top, bottom, titlebarsOnly] = this._getSettings(metaWindow);
      if (enabled) {
         // A signal manager for this window
         let signalManager = new SignalManager.SignalManager(null);

         // Setup the window opacity
         if (!window_opacity || window_opacity < 10 || window_opacity > 100 )
            window_opacity = 100;
         metaWindow.set_opacity(Math.round(window_opacity*2.55));

         // Plank will need a completely separate clipping path (_setClipPlank, driven by its own
         // "_PLANK_BACKGROUND_BLUR_REGION" property rather than a MetaWindow frame rect). The
         // backend in Plank has not been implmented in Plank in a way I can access here (yet).
         //
         // Dynamic blur reconstructs "what's really behind" this window out of clones of the
         // windows stacked below it, composited over the desktop background (see CloneManager).
         // Rather than run the blur shader over that whole full-screen composite and only crop the
         // *result* down to the visible rect afterwards (which is what background.set_clip() alone
         // would do), shrink the actual blurred surface itself down to just the clip rect via a
         // small "viewport" actor (see _createBackgroundAndEffects's useViewport). This keeps the
         // shader's edge sampling from ever reaching past the clip into un-cloned regions of the
         // screen - which is what let raw wallpaper bleed into the bottom of title-bar-only blurs
         // even when a window was really there - and it cuts the pixel count the blur has to
         // process from the whole monitor down to just the clip area, which is also a meaningful
         // GPU/CPU win.
         let useViewport = (blurType === BlurType.DynamicBlur || blurType === BlurType.DynamicMC || blurType === BlurType.DynamicDK) && metaWindow.get_wm_class() !== "Plank";

         // Create the effect(s) and add them to the window. background needs to sit at the bottom
         // of this window's compositor actor (index 0, below the window's own real content), and
         // viewport (when used) directly above it (index 1, still below that real content) - so
         // parenting is done via customParent rather than _createBackgroundAndEffects's generic
         // `parent` add_child fallback, which doesn't have index control.
         let background = this._createBackgroundAndEffects(opacity, blendColor, blurType, radius, saturation, null, corner_radius, top, bottom, useViewport,
            (bg, vp) => {
               compositor.insert_child_at_index(bg, 0);
               if (vp) compositor.insert_child_at_index(vp, 1);
            });
         background._blurCinnamonName = "Window";
         let viewport = background._blurCinnamonViewport;
         if (viewport) viewport._blurCinnamonName = "Window";

         // Add blur data to the compositor while blurring is in effect
         compositor._blurCinnamonDataWindow = { effectThis: this, background: background, viewport: viewport, metaWindow: metaWindow, signalManager: signalManager, titlebarsOnly: titlebarsOnly };

         // Add listeners for this window's compositor
         signalManager.connect(compositor, "destroy", () => this._unblurWindow(compositor) );
         if (metaWindow.get_wm_class() == "Plank") {
            //log( `Found a "Plank" window / ${metaWindow.get_id()}` );
            signalManager.connect(compositor, "notify::allocation", () => this._setClipPlank(metaWindow) );
            signalManager.connect(compositor, "notify::mapped", () => this._setClipPlank(metaWindow) );
            signalManager.connect(metaWindow, "raised", () => this._setClipPlank(metaWindow) );
            // Resize / reposition the blurred actor
            this.lastBlurGeometryString = null;
            this._setClipPlank(metaWindow);
         } else {
            // Some windows are positioned after their first allocation, so keep the blur aligned
            // when either the compositor actor or the MetaWindow reports a position update.
            signalManager.connect(compositor, "notify::allocation", () => this._setClip(compositor) );
            signalManager.connect(metaWindow, "position-changed", () => this._setClip(compositor) );
            // Resize / reposition & make visible the blurred actor
            this._setClip(compositor);
         }

         if (blurType === BlurType.DynamicBlur || blurType === BlurType.DynamicMC || blurType === BlurType.DynamicDK) {
            this._createDynamicEffect(background, metaWindow);
         }
      }
   }

   // Equivalent to BlurBase._updateEffects(), but for a window whose background has been wrapped in
   // a viewport (see _createBackgroundAndEffects's useViewport): the blur/corner/desaturate effects
   // live on the viewport, while the dimmer (color/opacity tint) stays on the background's group
   // since it's shared content the viewport merely clones and crops. This never needs to recreate the
   // background as a different actor type the way _updateEffects() sometimes does - viewport
   // wrapping only ever happens for the three Dynamic* blur types, and updateEffects() rebuilds
   // (via _unblurWindow()/_blurWindow()) rather than migrating in place whenever a window's blur
   // type moves into or out of that set.
   _updateWindowViewportEffects(background, viewport, opacity, blendColor, blurType, radius, saturation) {
      let curEffect = this._getBlurEffect(viewport);
      if (blurType === BlurType.DynamicBlur && !(curEffect instanceof GaussianBlur.GaussianBlurEffect)) {
         if (curEffect) viewport.remove_effect(curEffect);
         viewport.add_effect_with_name( BLUR_EFFECT_NAME, new GaussianBlur.GaussianBlurEffect( {radius: radius, brightness: 1, width: 0, height: 0} ) );
      } else if (blurType === BlurType.DynamicMC && !(curEffect instanceof MonteCarloBlur.MonteCarloBlurEffect)) {
         if (curEffect) viewport.remove_effect(curEffect);
         viewport.add_effect_with_name( BLUR_EFFECT_NAME, new MonteCarloBlur.MonteCarloBlurEffect( { radius: radius, iterations: settings.montecarloIterations, prefer_closer_pixels: settings.montecarloPerferCloserPixels, use_base_pixel: settings.montecarloUseBasePixel, brightness: 1, width: 0, height: 0 } ) );
      } else if (blurType === BlurType.DynamicDK && !(curEffect instanceof DualKawaseBlur.DualFilteringBlurEffect)) {
         if (curEffect) viewport.remove_effect(curEffect);
         viewport.add_effect_with_name( BLUR_EFFECT_NAME, new DualKawaseBlur.DualFilteringBlurEffect( { radius: radius, brightness: 1, width: 0, height: 0 } ) );
      }
      curEffect = this._getBlurEffect(viewport);
      if ((curEffect instanceof GaussianBlur.GaussianBlurEffect || curEffect instanceof MonteCarloBlur.MonteCarloBlurEffect || curEffect instanceof DualKawaseBlur.DualFilteringBlurEffect) && curEffect.radius != radius) {
         curEffect.radius = radius;
      }
      if (curEffect instanceof MonteCarloBlur.MonteCarloBlurEffect) {
         curEffect.iterations = settings.montecarloIterations;
         curEffect.use_base_pixel = settings.montecarloUseBasePixel;
         curEffect.prefer_closer_pixels = settings.montecarloPerferCloserPixels;
      }

      let desatEffect = this._getDesatEffect(viewport);
      if (desatEffect && saturation === 100) {
         viewport.remove_effect(desatEffect);
      } else if (desatEffect && desatEffect.factor !== (100-saturation)/100) {
         desatEffect.set_factor((100-saturation)/100);
      } else if (!desatEffect && saturation < 100) {
         viewport.add_effect_with_name( DESAT_EFFECT_NAME, new Clutter.DesaturateEffect({factor: (100-saturation)/100}) );
      }

      let dimmerColor = this._getColor( blendColor, opacity );
      background._blurCinnamonDimmer.set_background_color(dimmerColor);
   }

   /*
   _maximized(metaWindow) {
      let compositor = metaWindow.get_compositor_private();
      if (metaWindow.get_maximized()) {
         log( "maximized" );
         this._setClip(compositor);
      } else {
         log( "unmaximized" );
         this._setClip(compositor);
      }
   }*/

   // Get the window specific effect settings, or a disabled set of value when no settings exist
   _getSettings(metaWindow) {
      let titlebarsOnly = false;
      let enabled;
      let wmclass = metaWindow.get_wm_class();
      let winType = metaWindow.get_window_type();
      // We want to allow blurring for normal window, docks (i.e Plank) and desktop windows (i.e Conky)
      if ((winType === Meta.WindowType.NORMAL || (settings.windowsTitlebarBlur && (winType === Meta.WindowType.DIALOG || winType === Meta.WindowType.MODAL_DIALOG)) ||
           winType === Meta.WindowType.DOCK || winType === Meta.WindowType.DESKTOP) && wmclass !== "Nemo-desktop") 
      {
         let app = this._getAppForWindow(metaWindow);
         let appId = app ? app.get_id() : null;
         let element = settings.windowInclusionList.find( (element) => {if (element.application == appId || element.application == wmclass) {return true;}} );
         if (!element) {
            element = settings.windowInclusionList.find( (element) => {if (element.application == _("Default window settings")) {return true;}} );
            if (!element.enabled && settings.windowsTitlebarBlur) {
               titlebarsOnly = true;
               enabled = true;
            } else {
               enabled = element.enabled;
            }
         } else {
            enabled = element.enabled;
         }
         if (element) {
            if (element.override) {
               return [enabled, element.window_opacity, element.opacity, element.color, element.blurtype, element.radius, element.saturation, element.corner_radius, element.corner_top, element.corner_bottom, titlebarsOnly];
            }
            return [enabled, element.window_opacity, ...super._getSettings(false), element.corner_radius, element.corner_top, element.corner_bottom, titlebarsOnly ];
         }
      }
      return [false, 100, 0, undefined, BlurType.None, 0, 100, 0, false, false, false]
   }

   _setClip(compositor) {
      if (compositor._blurCinnamonDataWindow) {
         let data = compositor._blurCinnamonDataWindow;
         // When wrapped in a viewport (see _createBackgroundAndEffects's useViewport), data.background
         // stays a genuinely shown/positioned/clipped actor in its own right - not just a clone source - so
         // it needs to be shown/hidden in lockstep with the viewport that's painted on top of it.
         if (compositor.get_transition("x") || compositor.get_transition("y") ) {
            data.background.hide();
            if (data.viewport) data.viewport.hide();
            return;
         } else {
            data.background.show();
            if (data.viewport) data.viewport.show();
         }
         let rect = data.metaWindow.get_frame_rect();

         // If the window is shaded or the blur is for the titlebar only, then we only want to blur under the title bar.
         if (data.metaWindow.is_shaded() || data.titlebarsOnly) {
            let clientRect = data.metaWindow.frame_rect_to_client_rect(rect);
            rect.height = clientRect.y - rect.y;
            if (rect.height <= 0) {
               //rect.height = 3;        // Hack, bad things happen if we set the height to 0 or less
               // Hide the background (and viewport) since we can't determine the title bar height
               data.background.hide();
               if (data.viewport) data.viewport.hide();
               return;
            }
         }
         // Set the background position to the displays 0,0 based on the compositor's position and the shadow size
         //let windowShadowSizeX = (compositor.get_width() - rect.width) / 2;
         //let windowShadowSizeY = (compositor.get_height() - rect.height) / 2;
         //data.background.set_position( -rect.x+windowShadowSizeX, -rect.y+windowShadowSizeY );

         // Set the background position to the displays 0,0 based on it's transformed position and it's current position
         //let [rx,ry] = data.background.get_transformed_position();
         //let [x,y] = data.background.get_position();
         //data.background.set_position( x-rx, y-ry );
         // The blur background lives inside the window compositor actor, so it must be
         // offset by the compositor's transformed stage position, not by its own previous
         // transformed position. Otherwise the blur and the real window can drift apart.
         let [rx, ry] = compositor.get_transformed_position();

         // data.background is repositioned to global (0,0) exactly as it always was, whether or not
         // it's wrapped in a viewport - it stays a real, normally-shown/mapped actor either way.
         data.background.set_position(-rx, -ry);

         if (data.viewport) {
            // Wrapped: the corner/blur/desaturate effects live on the viewport now, not on
            // background, so background just gets a plain rectangular clip matching the visible
            // rect - the same clip the legacy (unwrapped) path below would give it if it had no
            // corner effect. That confines background's own raw, un-blurred paint to exactly the
            // area viewport is about to paint over.
            data.background.set_clip( rect.x, rect.y, rect.width, rect.height );

            // But a rectangular clip alone isn't enough when corners are rounded: viewport's own
            // corner effect cuts its 4 corners to transparent, so at those cutouts viewport no
            // longer covers background at all, and background's square un-blurred corner shows
            // straight through underneath. Mirror the same clip onto background's own corner
            // effect (see _createBackgroundAndEffects), using the legacy unwrapped formula's
            // coordinates (background isn't offset the way viewport is - see above), so its
            // corners get masked to the same rounded shape and nothing shows through there either.
            let backgroundCornerEffect = this._getCornerEffect(data.background);
            if (backgroundCornerEffect) {
               backgroundCornerEffect.clip = [rect.x+2, rect.y+2, rect.width-3, rect.height-3];
            }

            // Size/position the small viewport actor to exactly the visible clip rect (converted
            // from global/stage coordinates to compositor-local, since the viewport is a child of
            // the compositor), and offset its clone of the background so the matching crop of the
            // background/window-clone composite lands inside it. This is what keeps the blur shader
            // from ever sampling un-cloned regions of the screen past the clip's edges, and what
            // shrinks the texture it has to process down to just the clip area. Painted directly on
            // top of background (see _blurWindow's z-order), it fully covers background's own,
            // unblurred paint of the same rect.
            data.viewport.set_position(rect.x - rx, rect.y - ry);
            data.viewport.set_size(rect.width, rect.height);
            data.viewport._blurCinnamonSceneClone.set_position(-rect.x, -rect.y);

            let cornerEffect = this._getCornerEffect(data.viewport);
            if (cornerEffect) {
               // Local to the viewport now (the viewport *is* the clip rect), not global.
               cornerEffect.clip = [2, 2, rect.width-3, rect.height-3];
            }
         } else {
            let cornerEffect = this._getCornerEffect(data.background);
            if (cornerEffect) {
               cornerEffect.clip = [rect.x+2, rect.y+2, rect.width-3, rect.height-3];
            } else {
               data.background.set_clip( rect.x, rect.y, rect.width, rect.height );
            }
         }
         if (cloneManager)
            cloneManager.backgroundClipChanged(data.background);
      }
   }

   _unblurWindow(compositor) {
      if (compositor._blurCinnamonDataWindow) {
         let data = compositor._blurCinnamonDataWindow;
         data.signalManager.disconnectAllSignals();
         this._destroyDynamicEffect(data.background);
         // Strip every effect (background's own, and viewport's when wrapped - see
         // BlurBase.destroy()) one at a time *before* destroying either actor, so a multi-pass
         // blur effect's own reentrant sub-effect cleanup never races Clutter's own actor-destroy
         // teardown of the same effects list.
         super.destroy(data.background);
         if (data.viewport) {
            // Destroy the viewport (and its clone of data.background) before destroying
            // data.background itself, so nothing is left holding a clone of a destroyed source.
            compositor.remove_child(data.viewport);
            data.viewport.destroy();
         }
         compositor.remove_child(data.background);
         data.background.destroy();
         data.metaWindow.set_opacity(255);
         compositor._blurCinnamonDataWindow = undefined;
      }
   }

   // This is a work-around for some issues with Dynamic Blurring after switching workspaces or
   // restoring from minimized when a panel has dynamic blur effects applied
   reapplyEffects(metaWindow=null) {
      if (metaWindow) {
         let compositor = metaWindow.get_compositor_private();
         let data = compositor._blurCinnamonDataWindow;
         if (data) {
            debugMsg( "Reapplying effects to window" );
            Mainloop.idle_add( () => {
               if (global.display.list_windows(0).includes(metaWindow)) {
                  this._unblurWindow(compositor);
               }
            });
            Mainloop.idle_add( () => {
               if (global.display.list_windows(0).includes(metaWindow)) {
                  this._blurWindow(metaWindow);
               }
            });
         }
      } else {
         // Go through all windows and remove then reapply effects
         let windows = global.display.list_windows(0);
         for (let i = 0; i < windows.length; i++) {
            let compositor = windows[i].get_compositor_private();
            let data = compositor._blurCinnamonDataWindow;
            if (data) {
               debugMsg( "Reapplying effects to window" );
               Mainloop.idle_add( () => {
                  if (global.display.list_windows(0).includes(windows[i])) {
                     this._unblurWindow(compositor);
                  }
               });
               Mainloop.idle_add( () => {
                  if (global.display.list_windows(0).includes(windows[i])) {
                     this._blurWindow(windows[i]);
                  }
               });
            }
         }
      }
   }

   updateEffects() {
      // Go through all windows and update/apply/remove effects
      let windows = global.display.list_windows(0);
      for (let i = 0; i < windows.length; i++) {
         let compositor = windows[i].get_compositor_private();
         let data = compositor._blurCinnamonDataWindow;
         let [enabled, window_opacity, opacity, blendColor, blurType, radius, saturation, corner_radius, top, bottom, titlebarsOnly] = this._getSettings(windows[i]);
         if (compositor._blurCinnamonDataWindow) {
            if (!enabled) {
               this._unblurWindow(compositor);
            } else {
               let wantsViewport = (blurType === BlurType.DynamicBlur || blurType === BlurType.DynamicMC || blurType === BlurType.DynamicDK) && windows[i].get_wm_class() !== "Plank";
               if (!!data.viewport !== wantsViewport) {
                  // Whether this window's background needs to be wrapped in a viewport (see
                  // _createBackgroundAndEffects's useViewport) has changed - rebuild rather than
                  // migrate the actor tree in place, the same way reapplyEffects() rebuilds for
                  // other transitions.
                  let metaWindow = windows[i];
                  Mainloop.idle_add( () => {
                     if (global.display.list_windows(0).includes(metaWindow)) {
                        this._unblurWindow(compositor);
                     }
                  });
                  Mainloop.idle_add( () => {
                     if (global.display.list_windows(0).includes(metaWindow)) {
                        this._blurWindow(metaWindow);
                     }
                  });
                  continue;
               }
               data.titlebarsOnly = titlebarsOnly;
               let effectsActor = data.viewport || data.background;
               if (data.viewport) {
                  this._updateWindowViewportEffects(data.background, data.viewport, opacity, blendColor, blurType, radius, saturation);
               } else {
                  this._updateEffects(data.background, opacity, blendColor, blurType, radius, saturation);
               }
               let cornerEffect = this._getCornerEffect(effectsActor);
               if (cornerEffect) {
                  cornerEffect.corners_top = top;
                  cornerEffect.corners_bottom = bottom;
               }
               this._updateCornerRadius(effectsActor, corner_radius, top, bottom);
               if (data.viewport) {
                  // Keep background's mirrored corner effect (see _createBackgroundAndEffects/
                  // _setClip) in sync with viewport's the same way, so its corners stay masked to
                  // match rather than reverting to square once settings change.
                  let backgroundCornerEffect = this._getCornerEffect(data.background);
                  if (backgroundCornerEffect) {
                     backgroundCornerEffect.corners_top = top;
                     backgroundCornerEffect.corners_bottom = bottom;
                  }
                  this._updateCornerRadius(data.background, corner_radius, top, bottom);
               }
               if (!window_opacity || window_opacity < 10 || window_opacity > 100 )
                  window_opacity = 100;
               windows[i].set_opacity(Math.round(window_opacity*2.55));
               if (wantsViewport && !this._isDynamicEffectActive(data.background)) {
                  this._createDynamicEffect(data.background, data.metaWindow);
               }
            }
         } else if (enabled) {
            this._blurWindow(windows[i]);
         }
      }
   }

   _getAppForWindow(window) {
      let app = this._windowTracker.get_window_app(window);
      if (!app) {
        app = this._windowTracker.get_app_from_pid(window.get_pid());
      }
      if (app)
         return app;
      return null;
   }

   _onFocusChanged() {
      this.prev_focused_window = this.last_focused_window;
      this.last_focused_window = global.display.get_focus_window();
   }

   // Add a new app window list row for the application of the last focused window
   window_add_button_pressed() {
      if (this.prev_focused_window) {
         let app = this._getAppForWindow(this.prev_focused_window);
         if (app && !app.is_window_backed()) {
            let windowList = settings.settings.getValue("windows-inclusion-list");
            windowList.push( {enabled:true, application:app.get_id(), override: true, opacity:0, color:"rgb(0,0,0)", blurtype:BlurType.Gaussian, radius:10, saturation:100, corner_radius: 10, corner_top: true, corner_bottom: false  } );
            settings.settings.setValue("windows-inclusion-list", windowList);
         } else if (this.prev_focused_window.get_wm_class()) {
            let windowList = settings.settings.getValue("windows-inclusion-list");
            windowList.push( {enabled:true, application:this.prev_focused_window.get_wm_class(), override: true, opacity:0, color:"rgb(0,0,0)", blurtype:BlurType.Gaussian, radius:10, saturation:100, corner_radius: 10, corner_top: true, corner_bottom: false } );
            settings.settings.setValue("windows-inclusion-list", windowList);
         } else {
            let source = new MessageTray.Source(this.meta.name);
            let notification = new MessageTray.Notification(source, _("Error") + ": " + this.meta.name,
               _("Unable to determine the application or the WM_CLASS of the previously focused window, therefore Blur Cinnamon effects can not be applied to that window"),
               {icon: new St.Icon({icon_name: "cinnamon-burn-my-window", icon_type: St.IconType.FULLCOLOR, icon_size: source.ICON_SIZE })}
               );
            Main.messageTray.add(source);
            source.notify(notification);
         }
      }
   }

   _getPlankBlurRegion(xid) {
      let display = Gdk.Display.get_default();
      let gdkWindow = GdkX11.X11Window.foreign_new_for_display(display, xid);
      if (!gdkWindow)
         return null;

      let propAtom = Gdk.Atom.intern('_PLANK_BACKGROUND_BLUR_REGION', false);
      let typeAtom = Gdk.Atom.intern('CARDINAL', false);

      // length is in 32-bit units for a CARDINAL request; 8 values is plenty, ask for more to be safe
      let [success, actualType, actualFormat, data] =
         //gdkWindow.property_get(propAtom, typeAtom, 0, 32 /* longs */, false);
         Gdk.property_get(gdkWindow, propAtom, typeAtom, 0, 32 /* longs */, false);

      if (!success || !data || actualFormat !== 32)
         return null;

      // `data` is the raw byte buffer GJS hands back for the property.
      // Wrap it in a DataView so we can read native-endian uint32s out of it.
      let bytes = Uint8Array.from(data); // ensure it's a plain byte array
      let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

      let littleEndian = true; // true on x86/x86_64/ARM Linux (native host order)
      let values = [];
      for (let i = 0; i + 4 <= view.byteLength; i += 4)
         values.push(view.getUint32(i, littleEndian));

      if (values.length < 8)
         return null;

      return {
         x: values[0],
         y: values[1],
         width: values[2],
         height: values[3],
         radiusTopLeft: values[4],
         radiusTopRight: values[5],
         radiusBottomLeft: values[6],
         radiusBottomRight: values[7],
      };
   }

   _setClipPlank(metaWindow) {
      let compositor = metaWindow.get_compositor_private();
      let data = compositor._blurCinnamonDataWindow;
      if (!compositor.is_mapped()) {
         log( "plank is currently unmapped" );
         if (data)
            data.background.hide();
         return;
      }
      try {
         let xid = metaWindow.get_xwindow();
         let result = this._getPlankBlurRegion(xid);
         if (result) {
            let cornerEffect = this._getCornerEffect(data.background);
            if (cornerEffect) {
               log( `setclip using corner effect: ${result.x}, ${result.y}, ${result.width}, ${result.height}` );
               cornerEffect.clip = [result.x+2, result.y+2, result.width-3, result.height-3];
               this._updateCornerRadius(data.background, radius);
            } else {
               log( `setClip using background: ${result.x}, ${result.y}, ${result.width}, ${result.height}` );
               data.background.set_clip( result.x, result.y, result.width, result.height );
            }
            if (cloneManager)
               cloneManager.backgroundClipChanged(data.background);
         }
         /*
         let command = `xprop -id ${xid} _PLANK_BACKGROUND_BLUR_REGION`;
         log( `running: ${command}` );
         let [success, stdout] = GLib.spawn-command-line-sync(command);  // This call is considered unsafe by Cinnamon (because it's sync and code could run for a long time)
         log( `stdout: ${new TextDecoder().decode(stdout)}` );
         if (success && stdout) {
            log( "Got xprop" );
            let output = new TextDecoder().decode(stdout); //stdout.toString().trim();
            let match = output.match(/=\s*(.+)$/m);
            if (match) {
               log( "It's a match" );
               let geometryString = match[1].trim();
               // Only proceed if there is some change to apply
               if (geometryString == this.lastBlurGeometryString) {
                  log( "No change" );
                  return;
               }
               // Update cache with the new unique string
               this.lastBlurGeometryString = geometryString;
               // Split the output into 4 integers
               let blurData = geometryString.split(',').map(num => parseInt(num.trim(), 10));
               if (blurData.length >= 5) {
                  if (data) {
                     let [x, y, width, height, radius] = blurData;
                     log( `got 4 ints: ${x}, ${y}, ${width}, ${height}, ${radius}` );
                     data.background.show();
                     let cornerEffect = this._getCornerEffect(data.background);
                     if (cornerEffect) {
                        log( `setclip using corner effect: ${x}, ${y}, ${width}, ${height}` );
                        cornerEffect.clip = [x+2, y+2, width-3, height-3];
                        this._updateCornerRadius(data.background, radius);
                     } else {
                        log( `setClip using background: ${x}, ${y}, ${width}, ${height}` );
                        data.background.set_clip( x, y, width, height );
                     }
                     if (cloneManager)
                        cloneManager.backgroundClipChanged(data.background);
                  }
               }
            }
         }
         */
      } catch (e) {
         log( `Got exception:\n${e}` );
      }
   }

   destroy() {
      this._signalManager.disconnectAllSignals();
      // Go through all windows and remove effects when a windows compositor has a _blurCinnamonDataWindow field
      let windows = global.display.list_windows(0);
      for (let i = 0; i < windows.length; i++) {
         let compositor = windows[i].get_compositor_private();
         if (compositor._blurCinnamonDataWindow) {
            this._unblurWindow(compositor);
         }
      }
   }
}

class BlurFocusEffect extends BlurBase {
   constructor() {
      super();
      // global listeners
      this._signalManager = new SignalManager.SignalManager(null);
      this._signalManager.connect(global.display, "notify::focus-window", this._onFocusChanged, this);
      this._signalManager.connect(global.display, "grab-op-begin", this._onWindowGrabbed, this);
      this._signalManager.connect(global.display, "grab-op-end", this._onFocusChanged ,this);


      if (!Meta.is_wayland_compositor()) {
         this._background = Meta.X11BackgroundActor.new_for_display(global.display);
      } else {
         this._background = new Clutter.Actor();
      }

      // BlurFocusEffect deliberately does NOT use viewport-wrapping as it would prevent the blur
      // effect from bleeding over the windows borders which is how this "glow" effect is acheived.
      this._blurEffect = new GaussianBlur.GaussianBlurEffect( {radius: settings.focusedWindowEffect, brightness: 1 , width: 0, height: 0} );
      this._cornerEffect = new CornerEffect.CornerEffect( metaData.uuid, {radius: 10, corners_top: true, corners_bottom: true} );

      // By adding the corner effect after the blur effect, the blur effect will spill over the clip border slightly (based on the blur radius).
      // This gives a glow type of effect around the windows border best seen when the focused window is obove other windows.
      this._background.add_effect_with_name( BLUR_EFFECT_NAME, this._blurEffect );
      this._background.add_effect_with_name( CORNER_EFFECT_NAME, this._cornerEffect );
      this._background.hide();
      this._onFocusChanged();
   }

   _onWindowGrabbed() {
      // Give the "Compiz windows effect" time to attach the effect, then we remove the backlight effect if the Compiz effect is active.
      // The Compiz effect clips the backlight effect to the compositor actor bounds making for a bad visual result
      Mainloop.idle_add( () => {
         if (this._focusedCompositor && this._focusedCompositor.get_effect('wobbly-compiz-effect')) {
            this._removeEffect();
         }
      });
   }

   _onFocusChanged() {
      let window = global.display.get_focus_window();
      if (this._focusedWindow !== window) {
         this._removeEffect();
      }
      if (window && this._focusedWindow !== window && window.get_window_type() !== Meta.WindowType.DESKTOP) {
         this._addEffect(window);
      }
   }

   _addEffect(window) {
      this._focusedWindow = window;
      this._focusedCompositor = window.get_compositor_private();
      this._focusedCompositor.insert_child_at_index(this._background, 0);
      this._signalManager.connect(this._focusedCompositor, "notify::allocation", () => this._setClip() );
      this._signalManager.connect(window, "position-changed", () => this._setClip() );
      this._signalManager.connect(window, "unmanaging", () => this._removeEffect() );
      this._focusedCompositor._blurCinnamonDataFocusEffect = { effectThis: this };
      this._setClip();
      this._background.show();
   }

   _removeEffect() {
      this._background.hide();
      if (this._focusedCompositor) {
         this._signalManager.disconnect("notify::allocation", this._focusedCompositor );
         this._signalManager.disconnect("position-changed", this._focusedWindow );
         this._signalManager.disconnect("unmanaging", this._focusedWindow );
         this._focusedCompositor.remove_child(this._background);
         this._focusedCompositor._blurCinnamonDataFocusEffect = undefined;
      }
      this._focusedWindow = undefined;
      this._focusedCompositor = undefined;
   }

   _setClip() {
      if (this._focusedCompositor) {
         if (/*this._focusedCompositor.__animationInfo ||*/ this._focusedCompositor.get_transition("x") || this._focusedCompositor.get_transition("y") ) {
            this._background.hide();
            //if (this._focusedCompositor.__animationInfo)
            //   Mainloop.idle_add( () => this._setClip() );
            return;
         } else {
            this._background.show();
         }

         let rect = this._focusedWindow.get_frame_rect();
         // Set the background position to the displays 0,0 based on the compositor's position and the shadow size
         //let windowShadowSizeX = (compositor.get_width() - rect.width) / 2;
         //let windowShadowSizeY = (compositor.get_height() - rect.height) / 2;
         //data.background.set_position( -rect.x+windowShadowSizeX, -rect.y+windowShadowSizeY );

         // Set the background position to the displays 0,0 based on it's transformed position and it's current position
         //let [rx,ry] = this._background.get_transformed_position();
         //let [x,y] = this._background.get_position();
         //this._background.set_position( x-rx, y-ry );
         // Keep the focus background aligned with the compositor actor in stage coordinates.
         let [rx, ry] = this._focusedCompositor.get_transformed_position();
         this._background.set_position(-rx, -ry);

         // Deliberately NOT viewport-wrapped and NOT hard-clipped via background.set_clip() either
         // (see the constructor's comment) - the corner effect's own `clip` uniform is a purely
         // visual, shader-side mask, not a real geometric confinement of the blur's input FBO, so
         // the blur (running on this genuinely full-screen background) can still sample and spill
         // a few pixels past this rect for the glow effect.
         if (this._cornerEffect)
            this._cornerEffect.clip = [rect.x+2, rect.y+2, rect.width-3, rect.height-3];
         else
            this._background.set_clip( rect.x, rect.y, rect.width, rect.height );
      }
   }

   updateEffect(radius) {
      this._blurEffect.radius = radius;
   }

   destroy() {
      this._background.hide();
      this._signalManager.disconnectAllSignals();
      if (this._focusedCompositor) {
         this._focusedCompositor.remove_child(this._background);
      }
      this._focusedWindow = undefined;
      this._focusedCompositor = undefined;
      this._background.destroy();
   }
}

class BlurDesklets extends BlurBase {
   constructor() {
      super();
      // global listeners
      //this._signalManager = new SignalManager.SignalManager(null);

      blurDeskletsThis = this; // Make "this" available to monkey patched functions

      this.original_createDesklets = DeskletManager._createDesklets;
      DeskletManager._createDesklets = this._createDesklets;
      this.original_unloadDesklet = DeskletManager._unloadDesklet;
      DeskletManager._unloadDesklet = this._unloadDesklet;

      this.origianl_raise = DeskletManager.DeskletContainer.prototype.raise;
      DeskletManager.DeskletContainer.prototype.raise = this._raise;
      this.origianl_lower = DeskletManager.DeskletContainer.prototype.lower;
      DeskletManager.DeskletContainer.prototype.lower = this._lower;

      // Make sure all the Desklets are defined in the deskletList
      let desklets = DeskletManager.getDefinitions();
      for (let i=0 ; i<desklets.length ; i++) {
         let {uuid, desklet_id} = desklets[i];
         let desklet = desklets[i].desklet;
         if (desklet && uuid) {
            this._addDeskletToList(desklet);
         }
      }

      // Remove any deskletList entries that are not currently enabled
      let deskletList = settings.settings.getValue("desklets-list");
      for (let i=deskletList.length-1 ; i>=0 ; i-- ) {
         if ( !desklets.find( (element) => element.desklet.instance_id == deskletList[i].instance ) ) {
            deskletList.splice(i, 1);
         }
      }

      // Save desklets-list just in case we removed anything
      settings.settings.setValue("desklets-list", deskletList);

      // See if any desklets need to be blurred now that we have the desklets-list all setup right
      desklets = DeskletManager.getDefinitions();
      for (let i=0 ; i<desklets.length ; i++) {
         let {uuid, desklet_id} = desklets[i];
         let desklet = desklets[i].desklet;
         if (desklet && uuid) {
            this._blurDesklet(desklet);
         }
      }
   }

   _supportsDynamicBlur() {
      return true;
   }

   // Monkey patched function to raise the desklets
   _raise() {
      blurDeskletsThis.origianl_raise.call(this);
      blurDeskletsThis._deskletsRaised.call(blurDeskletsThis);
   }

   _deskletsRaised() {
      let desklets = DeskletManager.getDefinitions();
      for (let i=0 ; i<desklets.length ; i++) {
         let {uuid, desklet_id} = desklets[i];
         let desklet = desklets[i].desklet;
         if (desklet && desklet._blurCinnamonBackground) {
            let blurSettings = desklet._blurCinnamonBackground._blurCinnamonSettings;
            if(blurSettings[3] === BlurType.DynamicBlur || blurSettings[3] === BlurType.DynamicMC || blurSettings[3] === BlurType.DynamicDK) {
               this._raiseDeskletDynamicBackground(desklet._blurCinnamonBackground);
            }
         }
      }
   }

   // Monkey patched function to lower the deskelts
   _lower() {
      blurDeskletsThis.origianl_lower.call(this);
      blurDeskletsThis._deskletsLowered.call(blurDeskletsThis);
   }

   _deskletsLowered() {
      let desklets = DeskletManager.getDefinitions();
      for (let i=0 ; i<desklets.length ; i++) {
         let {uuid, desklet_id} = desklets[i];
         let desklet = desklets[i].desklet;
         if (desklet && desklet._blurCinnamonBackground) {
            let blurSettings = desklet._blurCinnamonBackground._blurCinnamonSettings;
            if(blurSettings[3] === BlurType.DynamicBlur || blurSettings[3] === BlurType.DynamicMC || blurSettings[3] === BlurType.DynamicDK) {
               this._lowerDeskletDynamicBackground(desklet._blurCinnamonBackground);
            }
         }
      }
   }

   _blurDesklet(desklet) {
      let content = desklet.content;
      let child = content.get_first_child();
      let themeNode;
      if (child instanceof St.Widget)
         themeNode = child.get_theme_node();
      let topRadius = 0;
      let bottomRadius = 0;
      let cornerRadius = 0;
      if (themeNode) {
         // TODO: Need to be able to independently round all four corners, needs improvements to the corner effect code!
         topRadius = themeNode.get_border_radius(St.Corner.TOPLEFT);
         bottomRadius = themeNode.get_border_radius(St.Corner.BOTTOMLEFT);
         cornerRadius = Math.max(topRadius, bottomRadius);
      }
      let deskletSettings = this._getDeskletSettings(desklet);
      let [enabled, opacity, blendColor, blurType, radius, saturation] = deskletSettings;
      if (enabled) {
         let useViewport = this._wantsViewport(blurType);
         let background = this._createBackgroundAndEffects(opacity, blendColor, blurType, radius, saturation, null, cornerRadius, topRadius!==0, bottomRadius!==0, useViewport,
            (bg, vp) => {
               global.desklet_container.insert_child_at_index(bg, 0);
               if (vp) global.desklet_container.insert_child_at_index(vp, 1);
            });
         background._blurCinnamonName = "Desklet";
         desklet._blurCinnamonBackground = background;
         background._blurCinnamonSettings = deskletSettings;
         let viewport = background._blurCinnamonViewport;
         if (viewport) viewport._blurCinnamonName = "Desklet";
         this._setClip(desklet);
         background.show();
         if (viewport) viewport.show();
         desklet._blurCinnamonSignalManager = new SignalManager.SignalManager(null);
         desklet._blurCinnamonSignalManager.connect(desklet.actor, "notify::allocation", () => this._setClip(desklet) );
         //desklet._blurCinnamonSignalManager.connect(desklet, "destroy", () => this._deskletRemoved(desklet) );
         if (blurType === BlurType.DynamicBlur || blurType === BlurType.DynamicMC || blurType === BlurType.DynamicDK) {
            this._createDynamicEffect(background, global.desklet_container, true);
         }
      }
   }

   // This is a monkey patched version of DeskletManager._createDesklets()
   // This is done so we know when new Desklets are added.
   _createDesklets(extension, deskletDefinition) {
      let desklet = blurDeskletsThis.original_createDesklets(extension, deskletDefinition);
      blurDeskletsThis._addDeskletToList(desklet);
      Mainloop.idle_add( () => { blurDeskletsThis._blurDesklet(desklet) } );
      return desklet;
   }

   // This is a monkey patched version of DeskletManager._unloadDesklet()
   // This is done so we know when Desklets are removed.
   _unloadDesklet(deskletDefinition, deleteConfig) {
      if (deskletDefinition.desklet) {
         blurDeskletsThis._deskletRemoved(deskletDefinition.desklet);
      }
      blurDeskletsThis.original_unloadDesklet(deskletDefinition, deleteConfig);
   }

   _getUniqueSettings() {
      return [settings.deskletsOpacity, settings.deskletsBlendColor, settings.deskletsBlurType, settings.deskletsRadius, settings.deskletsSaturation];
   }

   _getDeskletSettings(desklet) {
      if (!settings.deskletsOverride || !settings.enableDeskletsUniqueSettings) {
         return [true, ...this._getSettings(settings.deskletsOverride)];
      }
      let uuid = desklet._uuid;
      let instance = desklet.instance_id;
      let deskletList = settings.settings.getValue("desklets-list");
      let found = deskletList.find((element) => element.instance == instance );
      // It should always be found!! We add entries for new Desklet elsewhere
      if (found) {
         if (found.override) {
            return [found.enabled, found.opacity, found.color, found.blurtype, found.radius, found.saturation];
         } else {
            return [found.enabled, ...this._getGenericSettings()];
         }
      } else {
         log( `Blur Cinnamon error: Unable to locate Desklet list entry for ${uuid} / ${instance}` );
      }
   }

   _setClip(desklet) {
      if (desklet && desklet.actor && desklet._blurCinnamonBackground) {
         let actor = desklet.actor;
         let background = desklet._blurCinnamonBackground;
         let viewport = background._blurCinnamonViewport;
         this._applyBackgroundClip(background, viewport, actor.x, actor.y, actor.width, actor.height);
      }
   }

   updateEffects() {
      let deskletList = settings.settings.getValue("desklets-list");
      deskletList.forEach( (element) => {
         let desklet =  DeskletManager.get_object_for_instance(element.instance);
         if (desklet) {
            //log( `Updating ${desklet.metadata.name} / ${desklet._uuid} / ${desklet.instance_id} / ${(desklet._blurCinnamonBackground!==undefined)}` );
            let deskletSettings = this._getDeskletSettings(desklet);
            // If desklet was never blurred in the past, or any of the desklets blur settings have changed
            if (!desklet._blurCinnamonBackground || !deskletSettings.every( (e, i) => e == desklet._blurCinnamonBackground._blurCinnamonSettings[i] )) {
               let [enabled, opacity, blendColor, blurType, radius, saturation] = deskletSettings;
               if (desklet._blurCinnamonBackground) {
                  if (enabled) {
                     let wantsViewport = this._wantsViewport(blurType);
                     let viewport = desklet._blurCinnamonBackground._blurCinnamonViewport;
                     if (!!viewport !== wantsViewport) {
                        // Whether this desklet's background needs to be wrapped in a viewport (see
                        // _createBackgroundAndEffects's useViewport) has changed - rebuild rather
                        // than migrate the actor tree in place, the same way
                        // BlurApplications.updateEffects() rebuilds for the equivalent transition.
                        this._deskletDestroy(desklet);
                        this._blurDesklet(desklet);
                     } else if (viewport) {
                        this._updateViewportEffects(desklet._blurCinnamonBackground, viewport, opacity, blendColor, blurType, radius, saturation);
                     } else {
                        this._updateEffects( desklet._blurCinnamonBackground, opacity, blendColor, blurType, radius, saturation );
                     }
                     desklet._blurCinnamonBackground._blurCinnamonSettings = deskletSettings;
                     if ((blurType === BlurType.DynamicBlur || blurType === BlurType.DynamicMC || blurType === BlurType.DynamicDK) && !this._isDynamicEffectActive(desklet._blurCinnamonBackground)) {
                        this._createDynamicEffect(desklet._blurCinnamonBackground, global.desklet_container, true);
                     }
                  } else {
                     this._deskletDestroy(desklet);
                  }
               } else if (enabled) {
                  this._blurDesklet(desklet)
                  desklet._blurCinnamonBackground._blurCinnamonSettings = deskletSettings;
               }
            }
         }
      });
   }

   _addDeskletToList(desklet) {
      let deskletList = settings.settings.getValue("desklets-list");
      let found = deskletList.find((element) => element.instance == desklet.instance_id);
      if (!found) {
         // Add a new entry for this Desklet and set the "enabled" based on the auto setting
         deskletList.push( {enabled: settings.autoDeskletAdd, name: desklet.metadata.name, uuid: desklet._uuid, instance: desklet.instance_id} );
         settings.settings.setValue( "desklets-list", deskletList );
      } else {
         // Update the name of the Desklet just in case some Desklet update changed it's name in the metadata
         found.name = desklet.metadata.name;
         settings.settings.setValue( "desklets-list", deskletList );
      }
   }

   _removeDeskletFromList(desklet) {
      let deskletList = settings.settings.getValue("desklets-list");
      let idx = deskletList.findIndex((element) => element.uuid == desklet._uuid && element.instance == desklet.instance_id);
      if (idx!=-1) {
         deskletList.splice(idx, 1);
         settings.settings.setValue( "desklets-list", deskletList );
      }
   }

   _deskletDestroy(desklet) {
      if (desklet._blurCinnamonSignalManager) {
         desklet._blurCinnamonSignalManager.disconnectAllSignals();
         delete desklet._blurCinnamonSignalManager;
      }
      if (desklet._blurCinnamonBackground) {
         this._destroyDynamicEffect(desklet._blurCinnamonBackground);
         desklet._blurCinnamonBackground.hide();
         let viewport = desklet._blurCinnamonBackground._blurCinnamonViewport;
         if (viewport) viewport.hide();
         // Strip effects (background's and, when wrapped, viewport's) before destroying either
         // actor - see _destroyBackgroundAndViewport - so a multi-pass blur effect (Dual Kawase)
         // gets to tear its own sub-effects down cleanly first, same as every other consumer's
         // destroy path.
         this._destroyBackgroundAndViewport(desklet._blurCinnamonBackground, global.desklet_container);
         delete desklet._blurCinnamonBackground;
      }
   }

   _deskletRemoved(desklet) {
      this._deskletDestroy(desklet);
      this._removeDeskletFromList(desklet);
   }

   destroy() {
      let desklets = DeskletManager.getDefinitions();
      for (let i=0 ; i<desklets.length ; i++) {
         let {uuid, desklet_id} = desklets[i];
         let desklet = desklets[i].desklet;
         if (desklet && desklet._blurCinnamonBackground) {
            this._deskletDestroy(desklet);
         }
      }
      DeskletManager._createDesklets = this.original_createDesklets;
      DeskletManager._unloadDesklet = this.original_unloadDesklet;

      DeskletManager.DeskletContainer.prototype.raise = this.origianl_raise;
      DeskletManager.DeskletContainer.prototype.lower = this.origianl_lower;
   }
}

class BlurSettings {
   constructor(uuid) {
      this._signalManager = new SignalManager.SignalManager(null);
      this.settings = new Settings.ExtensionSettings(this, uuid);
      this.bind('opacity',    'opacity',    colorChanged);
      this.bind('blurType',   'blurType',   blurChanged);
      this.bind('radius',     'radius',     blurChanged);
      this.bind('blendColor', 'blendColor', colorChanged);
      this.bind('saturation', 'saturation', saturationChanged);

      this.bind('monte-carlo-iterations', 'montecarloIterations', blurChanged);
      this.bind('monte-carlo-use-base-pixel', 'montecarloUseBasePixel', blurChanged);
      this.bind('monte-carlo-prefer-closer-pixels', 'montecarloPerferCloserPixels', blurChanged);

      this.bind('overview-opacity',    'overviewOpacity');
      this.bind('overview-blurType',   'overviewBlurType');
      this.bind('overview-radius',     'overviewRadius');
      this.bind('overview-blendColor', 'overviewBlendColor');
      this.bind('overview-saturation', 'overviewSaturation');

      this.bind('expo-opacity',    'expoOpacity');
      this.bind('expo-blurType',   'expoBlurType');
      this.bind('expo-radius',     'expoRadius');
      this.bind('expo-blendColor', 'expoBlendColor');
      this.bind('expo-saturation', 'expoSaturation');

      this.bind('panels-opacity',    'panelsOpacity',    colorChanged);
      this.bind('panels-blurType',   'panelsBlurType',   blurChanged);
      this.bind('panels-radius',     'panelsRadius',     blurChanged);
      this.bind('panels-blendColor', 'panelsBlendColor', colorChanged);
      this.bind('panels-saturation', 'panelsSaturation', saturationChanged);
      this.bind('no-panel-effects-maximized', 'noPanelEffectsMaximized', maximizedOptionChanged );
      this.bind('hover-brighten-panels', 'hoverBrightenPanels' );

      this.bind('popup-opacity',        'popupOpacity',       updatePopupEffects);
      this.bind('popup-accent-opacity', 'popupAccentOpacity', updatePopupEffects);
      this.bind('popup-blurType',       'popupBlurType',      updatePopupEffects);
      this.bind('popup-radius',         'popupRadius',        updatePopupEffects);
      this.bind('popup-blendColor',     'popupBlendColor',    updatePopupEffects);
      this.bind('popup-saturation',     'popupSaturation',    updatePopupEffects);
      this.bind('allow-transparent-color-popup', 'allowTransparentColorPopup', updatePopupEffects);
      this.bind('popup-applet-menu-effects', 'popupAppletMenuEffects');
      this.bind('popup-panel-menu-effects',  'popupPanelMenuEffects');
      this.bind('popup-title-menu-effects',  'popupTitleMenuEffects');

      this.bind('desktop-opacity',       'desktopOpacity',      updateDesktopEffects);
      this.bind('desktop-blurType',      'desktopBlurType',     updateDesktopEffects);
      this.bind('desktop-radius',        'desktopRadius',       updateDesktopEffects);
      this.bind('desktop-blendColor',    'desktopBlendColor',   updateDesktopEffects);
      this.bind('desktop-saturation',    'desktopSaturation',   updateDesktopEffects);
      this.bind('desktop-with-focus',    'desktopWithFocus',    updateDesktopEffects);
      this.bind('desktop-without-focus', 'desktopWithoutFocus', updateDesktopEffects);

      this.bind('notification-opacity',    'notificationOpacity',    updateNotificationEffects);
      this.bind('notification-blurType',   'notificationBlurType',   updateNotificationEffects);
      this.bind('notification-radius',     'notificationRadius',     updateNotificationEffects);
      this.bind('notification-blendColor', 'notificationBlendColor', updateNotificationEffects);
      this.bind('notification-saturation', 'notificationSaturation', updateNotificationEffects);
      this.bind('allow-transparent-color-notifications', 'allowTransparentColorNotifications', updateNotificationEffects);

      this.bind('appswitcher-opacity',    'appswitcherOpacity');
      this.bind('appswitcher-blurType',   'appswitcherBlurType');
      this.bind('appswitcher-radius',     'appswitcherRadius');
      this.bind('appswitcher-blendColor', 'appswitcherBlendColor');
      this.bind('appswitcher-saturation', 'appswitcherSaturation');
      this.bind('appswitcher-disable-3d-panels', 'appswitcherDisablePanels');
      this.bind('appswitcher-allow-classic',     'appswitcherAllowClassic', enableClassicSwitcherChecked);
      this.bind('appswitcher-allow-3d',          'appswitcherAllow3D');
      this.bind('allow-transparent-color-switcher', 'allowTransparentColorSwitcher');

      this.bind('tooltips-opacity',    'tooltipOpacity');
      this.bind('tooltips-blurType',   'tooltipBlurType');
      this.bind('tooltips-radius',     'tooltipRadius');
      this.bind('tooltips-blendColor', 'tooltipBlendColor');
      this.bind('tooltips-saturation', 'tooltipSaturation');
      this.bind('allow-transparent-color-tooltips', 'allowTransparentColorTooltips');

      this.bind('desklets-opacity',    'deskletsOpacity',    updateDeskletEffects);
      this.bind('desklets-blurType',   'deskletsBlurType',   updateDeskletEffects);
      this.bind('desklets-radius',     'deskletsRadius',     updateDeskletEffects);
      this.bind('desklets-blendColor', 'deskletsBlendColor', updateDeskletEffects);
      this.bind('desklets-saturation', 'deskletsSaturation', updateDeskletEffects);

      this.bind('osd-opacity',        'osdOpacity');
      this.bind('osd-blurType',       'osdBlurType');
      this.bind('osd-radius',         'osdRadius');
      this.bind('osd-blendColor',     'osdBlendColor');
      this.bind('osd-saturation',     'osdSaturation');
      this.bind(`osd-slider-effects`, `osdSliderEffects`);
      this.bind(`osd-workspace-effects`, `osdWorkspaceEffects`);
      this.bind('allow-transparent-color-osd', 'allowTransparentColorOSD');

      this.bind('desklets-list',    'deskletList',        updateDeskletEffects);
      //this.bind('desklets-effects', 'deskletEffectsList', updateDeskletEffects);
      this.bind('desklets-auto',    'autoDeskletAdd',     updateDeskletEffects);
      this.bind('enable-desklets-unique-settings', 'enableDeskletsUniqueSettings', updateDeskletEffects);

      this.bind('windows-inclusion-list', 'windowInclusionList', updateWindowEffects);
      this.bind('windows-atrifact-mitigation', 'windowArtifactMitigation', updateArtifactMitigation);
      this.bind('windows-titlebar-blur', `windowsTitlebarBlur`, updateWindowEffects);

      this.bind('focused-window-backlight', 'focusedWindowEffect', updateFocusedWindowEffect);

      this.bind('enable-overview-override',     'overviewOverride');
      this.bind('enable-expo-override',         'expoOverride');
      this.bind('enable-panels-override',       'panelsOverride', panelsSettingsChangled);
      this.bind('enable-popup-override',        'popupOverride', updatePopupEffects);
      this.bind('enable-desktop-override',      'desktopOverride', updateDesktopEffects);
      this.bind('enable-notification-override', 'notificationOverride', updateNotificationEffects);
      this.bind('enable-appswitcher-override',  'appswitcherOverride');
      this.bind('enable-tooltips-override',     'tooltipsOverride');
      this.bind('enable-desklets-override',     'deskletsOverride', updateDeskletEffects);
      this.bind('enable-osd-override',          'osdOverride');

      this.bind('enable-overview-effects',      'enableOverviewEffects', enableOverviewChanged);
      this.bind('enable-expo-effects',          'enableExpoEffects',     enableExpoChanged);
      this.bind('enable-panels-effects',        'enablePanelsEffects',   enablePanelsChanged);
      this.bind('enable-popup-effects',         'enablePopupEffects',    enablePopupChanged);
      this.bind('enable-desktop-effects',       'enableDesktopEffects',  enableDesktopChanged);
      this.bind('enable-notification-effects',  'enableNotificationEffects', enableNotificationChanged);
      this.bind('enable-appswitcher-effects',   'enableAppswitcherEffects', enableClassicSwitcherChecked);
      this.bind('enable-tooltips-effects',      'enableTooltipEffects',  enableTooltipsChanged);
      this.bind('enable-window-effects',        'enableWindowEffects',  enableWindowChanged);
      this.bind('enable-desklet-effects',       'enableDeskletEffects',  enableDeskletChanged);
      this.bind('enable-osd-effects',           'enableOSDEffects',  enableOSDChanged);

      this.bind('enable-panel-unique-settings', 'enablePanelUniqueSettings');
      this.bind('panel-unique-settings', 'panelUniqueSettings', panelsSettingsChangled);
      this.bind('allow-transparent-color-panels', 'allowTransparentColorPanels', colorChanged);

      this.bind('new-install', 'newInstall');

      this.bind('component-selector', 'componentSelector');
   }

   // Since Cinnamon's settings does not allow binding to custom type json entries we have to have our own
   bind(key, variable, callback=null) {
      this._signalManager.connect(this.settings, "changed::"+key, () => this._keyChanged(key, variable, callback));
      this[variable] = this.settings.getValue(key);
   }

   _keyChanged(key, variable, callback) {
      let old = this[variable];
      this[variable] = this.settings.getValue(key);
      if (callback && old != this[variable]) {
         callback();
      }
   }

   destroy() {
      this._signalManager.disconnectAllSignals();
      this.settings.finalize();
   }
}

function maximizedOptionChanged() {
   if (blurPanels) {
      blurPanels.setupMaximizeMonitoring();
   }
}

function updateFocusedWindowEffect() {
   if (settings.focusedWindowEffect === 0){
      if (blurFocusEffect) {
         blurFocusEffect.destroy();
         blurFocusEffect = null;
      }
   } else if (settings.focusedWindowEffect > 0) {
      if (!blurFocusEffect) {
         blurFocusEffect = new BlurFocusEffect();
      } else {
         blurFocusEffect.updateEffect(settings.focusedWindowEffect);
      }
   }
}

function updateDeskletEffects() {
   if (blurDesklets && settings.enableDeskletEffects) {
      blurDesklets.updateEffects();
   }
}

function updateWindowEffects() {
   if (blurApplications && settings.enableWindowEffects) {
      blurApplications.updateEffects();
   }
}

function updateArtifactMitigation() {
   if (cloneManager) {
      cloneManager.updateArtifactMitigation();
   }
}

function updatePopupEffects() {
   if (blurPopupMenus && settings.enablePopupEffects) {
      blurPopupMenus.updateEffects();
   }
}

function updateDesktopEffects() {
   if (blurDesktop && settings.enableDesktopEffects) {
      blurDesktop.updateEffects();
   }
}

function updateNotificationEffects() {
   if (blurNotifications && settings.enableNotificationEffects) {
      blurNotifications.updateEffects();
   }
}

function saturationChanged() {
   if (blurPanels) {
      blurPanels.updateEffects();
   }
   if (blurDesktop && settings.enableDesktopEffects) {
      blurDesktop.updateEffects();
   }
   if (blurNotifications && settings.enableNotificationEffects) {
      blurNotifications.updateEffects();
   }
   if (blurApplications && settings.enableWindowEffects) {
      blurApplications.updateEffects();
   }
   if (blurDesklets && settings.enableDeskletEffects) {
      blurDesklets.updateEffects();
   }
   if (blurPopupMenus && settings.enablePopupEffects) {
      blurPopupMenus.updateEffects();
   }
}

function colorChanged() {
   if (blurPanels) {
      blurPanels.updateEffects();
   }
   if (blurDesktop && settings.enableDesktopEffects) {
      blurDesktop.updateEffects();
   }
   if (blurNotifications && settings.enableNotificationEffects) {
      blurNotifications.updateEffects();
   }
   if (blurApplications && settings.enableWindowEffects) {
      blurApplications.updateEffects();
   }
   if (blurDesklets && settings.enableDeskletEffects) {
      blurDesklets.updateEffects();
   }
   if (blurPopupMenus && settings.enablePopupEffects) {
      blurPopupMenus.updateEffects();
   }
}

function blurChanged() {
   if (blurPanels) {
      blurPanels.updateEffects();
   }
   if (blurDesktop && settings.enableDesktopEffects) {
      blurDesktop.updateEffects();
   }
   if (blurNotifications && settings.enableNotificationEffects) {
      blurNotifications.updateEffects();
   }
   if (blurApplications && settings.enableWindowEffects) {
      blurApplications.updateEffects();
   }
   if (blurDesklets && settings.enableDeskletEffects) {
      blurDesklets.updateEffects();
   }
   if (blurPopupMenus && settings.enablePopupEffects) {
      blurPopupMenus.updateEffects();
   }
}

function panelsSettingsChangled() {
   if (blurPanels) {
      blurPanels.updateEffects();
   }
}

function enableOverviewChanged() {
   if (settings.enableOverviewEffects) {
      Overview.Overview.prototype._animateVisible = _animateVisibleOverview;
      Overview.Overview.prototype._oldAnimateVisible = originalAnimateOverview;
   } else if (Overview.Overview.prototype._oldAnimateVisible) {
      delete Overview.Overview.prototype._oldAnimateVisible;
      Overview.Overview.prototype._animateVisible = originalAnimateOverview;
   }
}

function enableExpoChanged() {
   if (settings.enableExpoEffects) {
      Expo.Expo.prototype._animateVisible = _animateVisibleExpo;
      Expo.Expo.prototype._oldAnimateVisible = originalAnimateExpo;
   } else if (Expo.Expo.prototype._oldAnimateVisible) {
      delete Expo.Expo.prototype._oldAnimateVisible;
      Expo.Expo.prototype._animateVisible = originalAnimateExpo;
   }
}

function enableClassicSwitcherChecked() {
   if (settings.enableAppswitcherEffects && settings.appswitcherAllowClassic) {
      blurClassicSwitcher = new BlurClassicSwitcher();
   } else {
      if (blurClassicSwitcher) {
         blurClassicSwitcher.destroy();
         blurClassicSwitcher = null;
      }
   }
}

function enablePanelsChanged() {
   if (blurPanels && !settings.enablePanelsEffects) {
      blurPanels.destroy();
      blurPanels = null;
   } else if (!blurPanels && settings.enablePanelsEffects) {
      blurPanels = new BlurPanels();
   }
}

function enablePopupChanged() {
   if (blurPopupMenus && !settings.enablePopupEffects) {
      blurPopupMenus.destroy();
      blurPopupMenus = null;
   } else if (!blurPopupMenus && settings.enablePopupEffects) {
      blurPopupMenus = new BlurPopupMenus();
   }
}

function enableDesktopChanged() {
   if (blurDesktop && !settings.enableDesktopEffects) {
      blurDesktop.destroy();
      blurDesktop = null;
   } else if (!blurDesktop && settings.enableDesktopEffects) {
      blurDesktop = new BlurDesktop();
   }
}

function enableNotificationChanged() {
   if (blurNotifications && !settings.enableNotificationEffects) {
      blurNotifications.destroy();
      blurNotifications = null;
   } else if (!blurNotifications && settings.enableNotificationEffects) {
      blurNotifications = new BlurNotifications();
   }
}

function enableTooltipsChanged() {
   if (blurTooltips && !settings.enableTooltipEffects) {
      blurTooltips.destroy();
      blurTooltips = null;
   } else if (!blurTooltips && settings.enableTooltipEffects) {
      blurTooltips = new BlurTooltips();
   }
}

function enableWindowChanged() {
   if (blurApplications && !settings.enableWindowEffects) {
      blurApplications.destroy();
      blurApplications = null;
   } else if (!blurApplications && settings.enableWindowEffects) {
      blurApplications = new BlurApplications();
   }
}

function enableDeskletChanged() {
   if (blurDesklets && !settings.enableDeskletEffects) {
      blurDesklets.destroy();
      blurDesklets = null;
   } else if (!blurDesklets && settings.enableDeskletEffects) {
      blurDesklets = new BlurDesklets();
   }
}

function enableOSDChanged() {
   if (blurOSD && !settings.enableOSDEffects) {
      blurOSD.destroy();
      blurOSD = null;
   } else if (!blurOSD && settings.enableOSDEffects) {
      blurOSD = new BlurOSD();
   }
}

function init(extensionMeta) {
   metaData = extensionMeta;

   // Store the original functions for monkey patched functions
   originalAnimateOverview = Overview.Overview.prototype._animateVisible;
   originalAnimateExpo = Expo.Expo.prototype._animateVisible;
   originalShowAppSwitcher3D = AppSwitcher3D.AppSwitcher3D.prototype._show;
   originalHideAppSwitcher3D = AppSwitcher3D.AppSwitcher3D.prototype._hide;
   originalSizeChangeWindowDone = Main.wm._sizeChangeWindowDone;
}

function enable() {
   settings = new BlurSettings(metaData.uuid);

   // Save the version number to the settings so that the About page can read it (is there a better way?)
   settings.settings.setValue("ext-version", metaData.version);

   // Monkey patch to enable Overview effects
   if (settings.enableOverviewEffects) {
      Overview.Overview.prototype._animateVisible = this._animateVisibleOverview;
      Overview.Overview.prototype._oldAnimateVisible = originalAnimateOverview;
   }

   // Monkey patch to enable Expo effects
   if (settings.enableExpoEffects) {
      Expo.Expo.prototype._animateVisible = this._animateVisibleExpo;
      Expo.Expo.prototype._oldAnimateVisible = originalAnimateExpo;
   }

   // Monkey patch to enable 3D AppSwitcher effects
   AppSwitcher3D.AppSwitcher3D.prototype._show = this._showAppSwitcher3D;
   AppSwitcher3D.AppSwitcher3D.prototype._oldShow = originalShowAppSwitcher3D;
   AppSwitcher3D.AppSwitcher3D.prototype._hide = this._hideAppSwitcher3D;
   AppSwitcher3D.AppSwitcher3D.prototype._oldHide = originalHideAppSwitcher3D;

   // Unconditionally monkey patch _sizeChangeWindowDone since it's needed for two effects
   Main.wm._sizeChangeWindowDone = _sizeChangeWindowDoneWindowManager;

   // Create a OsdWindow Effects class instance, the constructor will kick things off
   if (settings.enableOSDEffects) {
      blurOSD = new BlurOSD();
   }
   // Create a Classic Switcher Effects class instance, the constructor will kick things off
   if (settings.enableAppswitcherEffects && settings.appswitcherAllowClassic) {
      blurClassicSwitcher = new BlurClassicSwitcher();
   }
   // Create a Panel Effects class instance, the constructor will kick things off
   if (settings.enablePanelsEffects) {
      blurPanels = new BlurPanels();
   }
   // Create a Popup menu Effects class instance, the constructor will set everything up.
   if (settings.enablePopupEffects) {
      blurPopupMenus = new BlurPopupMenus();
   }
   // Create a Desktop Effects class instance, the constructor will set everything up.
   if (settings.enableDesktopEffects) {
      blurDesktop = new BlurDesktop();
   }
   // Create a Notification Effects class instance, the constructor will set everything up.
   if (settings.enableNotificationEffects) {
      blurNotifications = new BlurNotifications();
   }
   // Create a Tooltip Effects class instance, the constructor will set everything up.
   if (settings.enableTooltipEffects) {
      blurTooltips = new BlurTooltips();
   }
   // Create a Application (Window) Effects class instance, the constructor will set everything up.
   if (settings.enableWindowEffects) {
      // Enable on idle, to avoid a bug where windows freeze for some reason on a Cinnamon restarts
      Mainloop.idle_add( () => { blurApplications = new BlurApplications(); } );
   }
   // Create a Focused Window Effect class instance, the constructor will set everything up.
   if (settings.focusedWindowEffect > 0) {
      blurFocusEffect = new BlurFocusEffect();
   }
   // Create a Focused Window Effect class instance, the constructor will set everything up.
   if (settings.enableDeskletEffects > 0) {
      blurDesklets = new BlurDesklets();
   }
   // If this is the first time running Blur Cinnamon, send a welcome notification message
   if (settings.newInstall) {
      settings.settings.setValue( "new-install", 0 );
      let source = new MessageTray.Source(metaData.name);
      let notification = new MessageTray.Notification(source, _("Welcome to Blur Cinnamon"),
         _("Hope you are enjoying your new Panel, Expo, Overview and Alt-Tab effects.\n\nOpen the Blur Cinnamon Settings to enable additional effects on several other desktop elements like menus, notifications and windows, or disable effects on components that were enabled by default. You can also make changes to the effect properties like blur intensity, color saturation and dimming."),
         {icon: new St.Icon({icon_name: "blur-cinnamon", icon_type: St.IconType.FULLCOLOR, icon_size: source.ICON_SIZE })}
         );
      Main.messageTray.add(source);
      notification.addButton("blur-cinnamon-settings", _("Open Blur Cinnamon Settings"));
      notification.connect("action-invoked", (self, id) => { if (id === "blur-cinnamon-settings") Util.spawnCommandLineAsync("xlet-settings extension " + metaData.uuid ); } );
      notification.setUrgency( MessageTray.Urgency.CRITICAL );
      source.notify(notification);
   }
   return Callbacks;
}

function disable() {
   if (Overview.Overview.prototype._oldAnimateVisible) {
      delete Overview.Overview.prototype._oldAnimateVisible;
      Overview.Overview.prototype._animateVisible = originalAnimateOverview;
   }

   if (Expo.Expo.prototype._oldAnimateVisible) {
      delete Expo.Expo.prototype._oldAnimateVisible;
      Expo.Expo.prototype._animateVisible = originalAnimateExpo;
   }

   delete AppSwitcher3D.AppSwitcher3D.prototype._oldShow;
   AppSwitcher3D.AppSwitcher3D.prototype._show = originalShowAppSwitcher3D;
   delete AppSwitcher3D.AppSwitcher3D.prototype._oldHide;
   AppSwitcher3D.AppSwitcher3D.prototype._hide = originalHideAppSwitcher3D;

   Main.wm._sizeChangeWindowDone = originalSizeChangeWindowDone;

   if (blurOSD) {
      blurOSD.destroy();
      blurOSD = null;
   }

   if (blurClassicSwitcher) {
      blurClassicSwitcher.destroy();
      blurClassicSwitcher = null;
   }

   if (blurPanels) {
      blurPanels.destroy();
      blurPanels = null;
   }

   if (blurPopupMenus) {
      blurPopupMenus.destroy();
      blurPopupMenus = null;
   }

   if (blurDesktop) {
      blurDesktop.destroy();
      blurDesktop = null;
   }

   if (blurNotifications) {
      blurNotifications.destroy();
      blurNotifications = null;
   }

   if (blurTooltips) {
      blurTooltips.destroy();
      blurTooltips = null;
   }

   if (blurApplications) {
      blurApplications.destroy();
      blurApplications = null;
   }

   if (blurFocusEffect) {
      blurFocusEffect.destroy();
      blurFocusEffect = null;
   }

   if (blurDesklets) {
      blurDesklets.destroy();
      blurDesklets = null;
   }

   // If disabled was called to remove the extension entirely rather than a reload
   // we can reset the "new-install" value so that if the user adds the extension
   // again in the future, we can show the welcome notification again!
   let err = new Error();
   if (err.stack.includes("unloadRemovedExtensions@")) {
      settings.settings.setValue( "new-install", 1 );
   }
   settings.destroy();
   settings = null;
}

const Callbacks = {
  on_notification_test_button_pressed: function() {
     let source = new MessageTray.Source(metaData.name);
     let notification = new MessageTray.Notification(source, _("Testing Blur Cinnamon Notification Effects"),
         _("This is how notifications will appear when using the current Blur Cinnamon Notification Popup effects.\n\nMaking further changes to the notification effect settings will automatically apply to this notification message."),
         {icon: new St.Icon({icon_name: "blur-cinnamon", icon_type: St.IconType.FULLCOLOR, icon_size: source.ICON_SIZE })}
         );
      Main.messageTray.add(source);
      notification.setUrgency( MessageTray.Urgency.CRITICAL );
      source.notify(notification);
   },

   on_window_settings_button_pressed: function() {
      Util.spawnCommandLineAsync("cinnamon-settings windows -t 2");
   },

   on_window_add_button_pressed: function() {
      if (blurApplications) {
         blurApplications.window_add_button_pressed();
      }
   }
}
