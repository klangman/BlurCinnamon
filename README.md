# Blur Cinnamon

A Cinnamon extension to Blur, Dim, Colorize, Desaturate and make transparent parts of the Cinnamon Desktop.

Cinnamon components you can effect (currently):

1. The overview
2. The Expo
3. Panels
4. Panel applet popup menus (i.e Menu menu, Calendar, etc.)
5. Desktop background
6. Notifications
7. Alt-Tab switchers
8. Panel Tooltips
9. Application Windows (including a Titlebar blurring option)
10. Desklet backgrounds

![screen shot](BlurCinnamon@klangman/screenshot.png)

## Features

1. Gaussian blur algorithm (borrowed from the Gnome extension Blur-my-Shell) with a user configurable intensity
2. Dual Kawase blur algorithm by Lucas-X-A optimized for lower power GPUs
3. Simple blur algorithm (the Cinnamon built-in algorithm) which I would only recommend for very old computers
4. Dimming overlay with user configurable color and intensity (fully-transparent to a solid color)
5. Makes the Panels, Popup menus and the Expo transparent so that the desktop background image effects are visible
6. Allows you to adjust the color saturation of the background overlay. You can reduced or completely desaturated (i.e gray scale)
7. You can use general settings for Popups/Panels/Overview/Expo or use unique settings for each
8. You can blur, dim and desaturate the desktop background image
9. The desktop background image effects can be configured to only apply when the desktop is not in focus

## Requirements

This extension requires Cinnamon 6.0 or better (i.e Mint 21.3 or better).

If you have installed any of the following Cinnamon extensions, you should **disable** them **before** enabling Blur Cinnamon:

- Transparent panels
- Transparent panels reloaded
- Blur Overview

Using any of the above with Blur Cinnamon may have some odd side effects that would require a Cinnamon restart to resolve.

## Limitations

1. The Applet popup-menu effects works for all the applets that I have tested except "Cinnamenu". Cinnamenu is preventing other code from receiving the "open-state-changed" event which BlurCinnamon uses to know when to apply popup-menu theme setting and when to resize and show the blur background element. This issue is fixed in the latest Cinnamenu from [Fredcw GitHub](https://github.com/fredcw/Cinnamenu) but you will need to manually fix the current Cinnamon Spices version of Cinnamenu (see [here](https://github.com/linuxmint/cinnamon-spices-extensions/issues/873))
2. This extension currently does not work under Wayland, it only works under X11. The extension automatically detects wayland and disables most of the features of the extension. I hope to add wayland support when Linux Mint 23 is released.

## Installation

This extension is also available on Cinnamon Spices. It can be installed directly from within Cinnamon using the "Extensions" application under the "System Settings".

[Blur Cinnamon on Cinnamon Spices](https://cinnamon-spices.linuxmint.com/extensions/view/104)

For the latest cutting edge development version, follow these instructions to install manually:

1. Clone the repo (or Download the latest repo by clinking on the green "code" button above then click "Download ZIP")
   
   ```
   git clone https://github.com/klangman/BlurCinnamon.git
   ```

2. If you downloaded a ZIP, decompress the zip into a directory of your choice
   
   ```
   unzip ~/Downloads/BlurCinnamon-main.zip
   ```

3. Change directory to the cloned repo or the decompressed ZIP file

4. Link the "BlurCinnamon@klangman" directory into the "~/.local/share/cinnamon/extensions/" directory
   
   ```
   ln -s $PWD/BlurCinnamon@klangman ~/.local/share/cinnamon/extensions/BlurCinnamon@klangman
   ```

5. Open the Cinnamon Extensions application (Menu->Preferences->Extensions)

6. Select the "Blur Cinnamon" entry and then click the "+" button at the bottom of the Extensions window

7. Use the "gears" icon to open the Blur Cinnamon setting window and setup the preferred behavior

## Window Title Bar Blurring

1. Enable the "Blur window title bars" option under the "Component specific settings" tab with the "Windows" component selected.

2. Add the following CSS code into the `~/.config/gtk-3.0/gtk.css` file. Create the file if it does not exist, which will likely be the case.
   
   ```
   /* Make the titlebars semi-transparent, Opacity 0.5 */
   headerbar, .titlebar {
    background-color: rgba(24, 60, 181, 0.5);
    border: none;
    box-shadow: none;
   }
   ```

3. Restart Cinnamon: ALT-F2, type r, press Enter

Limitations: 

1. This only works for GTK3 windows, GTK4 windows will not be effected, and as I understand it they can not be changed to have transparent title bars.

2. The title bar controls (close, minimize, maximize, etc.) will also be made semi-transparent, I was unable to find a way to have solid controls, but maybe someone that knows Cinnamon/GTK3 CSS better than I can make it solid?

3. Windows that draw there own titlebars (ie. Firefox, Chrome, Discord, etc.) will not be effected. In fact chrome is effected, but Blur Cinnamon is unable to determine the height of the titlebar and therefore it is left without blurring effects. For Chrome you can enable the "Use system title bar and borders" option.

4. The CSS code here only works for Mint-Y Application themes. The Mint-X theme does not work, but maybe could be made to work with different CSS code.

## Feedback

Feel free to open an issue here in my Github repo if you want to make a suggestion or report an issue.

If you like this Cinnamon extension, "star" this Github repository and its Cinnamon-spices [page]([Extensions : Blur Cinnamon : Cinnamon Spices](https://cinnamon-spices.linuxmint.com/extensions/view/104) to encourage me to continue working on the project. Thanks!

## Credits

Some code was borrowed from the [BlurOverview](https://cinnamon-spices.linuxmint.com/extensions/view/72) Extension by nailfarmer.

The Dual Kawase effect was written by <a href=\"https://github.com/Lucas-X-A\">Lucas-X-A</a>

The Gaussian and rounded corner effect code was borrowed from the Gnome [Blur my shell](https://github.com/aunetx/blur-my-shell) extension by [Aurélien Hamy](https://github.com/aunetx).

The Blur Cinnamon icon was generated by Google Gemini
