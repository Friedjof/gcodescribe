# Workshop · Demo stroke font

[**Download workshop-demo.gcsfont**](workshop-demo.gcsfont)

This original monoline font was drawn for the documentation. It contains lowercase and uppercase letters, German umlauts, ß, digits and punctuation. Every character has three slightly different variants made from real, editable pen strokes.

The font is synthetic and does not reproduce anyone's personal handwriting. Use it as a starting point for exploring the editor, then add more characters and your own variants.

## Import

1. Open the **Font Editor** workspace.
2. Select **Installed fonts → Add** and import the `.gcsfont` file.
3. Return to the editor, open **My fonts** and choose **Workshop – Demo**.
4. Edit a character or open **Writing test**.

The file is a JSON document in GCodeScribe's export format. It includes raw points, processed pen strokes, character variants and font metrics.

The original demo geometry is also available in the reproducible [fixture script](../../scripts/docs/create_demo.py). The script requires an explicitly selected, empty data directory and never overwrites existing application data.
