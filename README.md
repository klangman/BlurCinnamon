# Blur Cinnamon

A Cinnamon extension to Dim, Blur and Colorize parts of the Cinnamon Desktop.

![screen shot](BlurCinnamon@klangman/screenshot.png)

## Features

1. Gaussian blur algorithm (borrowed from the Gnome extension Blur-my-Shell) with a user configurable intensity
2. Dimming overlay with user configurable color and intensity (0-100%, transparent to a solid color)
3. Simple blur algorithm (the Cinnamon built-in algorithm) which I would only recommend for very old computers
4. Makes the Panels and the Expo transparent so that the desktop background image effects are visible
5. Applies blurring, colorization and dimming effects to all Panels, the Overview and the Expo
6. You can use general settings for Panels/Overview/Expo or use unique settings for each Cinnamon component

## Requirements

This extension requires Cinnamon 6.0 or better (i.e Mint 21.3 or better).

If you have installed any of the following Cinnamon extensions, you should **disable** them **before** enabling Blur Cinnamon:

- Transparent panels
- Transparent panels reloaded
- Blur Overview

Using any of the above with Blur Cinnamon may have some odd side effects that would require a Cinnamon restart to resolve.

## Limitations

1. Currently, any windows that are moved such that they overlap with a panel will not be visible beneath the panel as you might expect with a transparent panel. This is because the blur effect is applied to a user interface element that floats above all windows just like the panel floats above the windows. At some point I hope to look into making the blur element appear below all windows rather than above.
2. If you disable effects for the Overview, Expo or Panels under the General tab of the setting dialog while any "Override the generic effect settings" options are enabled under the other tabs, the components "effect setting" options under the other tabs will still be visible, but changing those setting will have no effect until you re-enable the component under the General tab. Ideally those effect setting would only be visible when the component is enabled under the general tab but Cinnamon setting support is a bit limited in this way.

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

## Feedback

Feel free to open an issue here in my Github repo if you want to make a suggestion or report an issue.

If you like this Cinnamon extension, "star" this Github repository to encourage me to continue working on the project. Thanks!

## Credits

Some code was borrowed from the [BlurOverview](https://cinnamon-spices.linuxmint.com/extensions/view/72) Extension by nailfarmer.

The Gaussian effect code was borrowed from the Gnome [Blur my shell](https://github.com/aunetx/blur-my-shell) extension by [Aurélien Hamy](https://github.com/aunetx).

The Blur Cinnamon icon was generated by Google Gemini
