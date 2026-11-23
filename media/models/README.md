# GCodeScribe Ai3MS · Hardware v2

Current print parts for the pen holder on the **Anycubic i3 Mega S**. Hardware revision v2 is independent of software version v0.6.1.

## Downloads

| Part | STL | STL bounding-box dimensions |
|---|---|---|
| Printer mount | [mount](GCodeScribe-Ai3MS-v2-mount.stl) | Approx. 48.91 × 55.51 × 29 mm |
| Pen holder | [pen](GCodeScribe-Ai3MS-v2-pen.stl) | Approx. 31.5 × 70 × 27.75 mm |
| Plate | [plate](GCodeScribe-Ai3MS-v2-plate.stl) | Approx. 40 × 61 × 29 mm |

- [All three print parts as a ZIP](GCodeScribe-Ai3MS-v2-print-parts.zip)
- [Editable STEP model](GCodeScribe-Ai3MS-v2.step)
- [Native Fusion design](GCodeScribe-Ai3MS-v2.f3d)

Dimensions were measured from the STL coordinates; they do not indicate a recommended print orientation. Import every part in millimetres at **100% scale**. Choose orientation, supports and a print profile to suit the geometry and your printer. Machine-ready G-code is not provided as a universal print file.

## Materials and tools

| Material | Quantity |
|---|---:|
| Magnets, 5 mm diameter | 10 |
| M3 threaded inserts | 2 |
| M3 screws | 2 |
| Medium-sized rubber band | 1 |
| Filament | Enough for three print parts |
| Liquid superglue | As needed |

Tools: a matching hex key and, optionally, a small hammer for inserting the magnets. The STEP file includes sockets with a 2.5 mm radius. Check the required magnet thickness, screw length and insert geometry against the design before buying or fitting components.

## Assembly

1. Print the three v2 parts, remove support material and check the mating surfaces.
2. Check magnet-pair polarity in the intended assembly before gluing. Fit the magnets, secure them with liquid superglue and let the glue cure.
3. Fit the M3 threaded inserts using the method appropriate for their type. Attach the printer mount using the two M3 screws.
4. Assemble the plate and pen holder using the STEP/Fusion model as a reference, then fit the medium-sized rubber band to its attachment points.
5. In GCodeScribe, choose a profile matching your machine, define the insertion position and calibrate pen heights. Check the paper corners and test points afterwards.

The [assembly photo](../hardware/pen-mount-printer.jpg) illustrates how the printed holder works. It does not define every detail of the v2 geometry.

The [release page](https://github.com/Friedjof/gcodescribe/releases/tag/v0.6.1) also provides the three STLs, ZIP and both CAD files as direct downloads.

## Earlier designs

Earlier STL, STEP, Fusion and experimental designs remain under [`old/`](old/). They are not part of the current v2 print set and should not be mixed with its parts.

The three separate v2 STLs were copied from the supplied `CGodeScribe-Ai3MS_v2.0_{mount,pen,plate}.stl` files. The original files in the Downloads directory are unchanged.
