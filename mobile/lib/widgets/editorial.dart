import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../theme.dart';

enum StudioScene { writing, voice, ideas, routine, celebrate }

/// Local vector art: decorative, offline, and crisp at any display scale.
class StudioArt extends StatelessWidget {
  const StudioArt({
    super.key,
    this.scene = StudioScene.writing,
    this.height = 148,
  });
  final StudioScene scene;
  final double height;
  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: RepaintBoundary(
      child: SizedBox(
        height: height,
        width: height * 1.43,
        child: CustomPaint(painter: _StudioPainter(scene)),
      ),
    ),
  );
}

class StudioBanner extends StatelessWidget {
  const StudioBanner({
    super.key,
    required this.title,
    required this.caption,
    this.eyebrow = 'BYLINE STUDIO',
    this.scene = StudioScene.writing,
    this.compact = false,
  });
  final String title, caption, eyebrow;
  final StudioScene scene;
  final bool compact;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, box) {
      final small = box.maxWidth < 520;
      final showArt =
          box.maxWidth >= 320 &&
          MediaQuery.textScalerOf(context).scale(14) <= 19;
      final artHeight = compact
          ? (small ? 70.0 : 96.0)
          : (small ? 92.0 : 156.0);
      return Container(
        padding: EdgeInsets.all(small ? 20 : 28),
        decoration: BoxDecoration(
          color: scene == StudioScene.celebrate
              ? AppSurfaces.green
              : AppSurfaces.blue,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: AppSurfaces.border),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    eyebrow,
                    style: T.small.copyWith(
                      color: C.filament,
                      fontSize: 12,
                      letterSpacing: 1.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    title,
                    style: T.title.copyWith(
                      fontSize: compact ? 21 : (small ? 24 : 32),
                      height: 1.18,
                      letterSpacing: -0.5,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(caption, style: compact ? T.small : T.body),
                ],
              ),
            ),
            if (showArt) ...[
              SizedBox(width: small ? 8 : 20),
              StudioArt(scene: scene, height: artHeight),
            ],
          ],
        ),
      );
    },
  );
}

/// A quiet writing cue, not an AI-generated recommendation or activity metric.
class WritingPrompt extends StatelessWidget {
  const WritingPrompt({super.key});
  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(top: 20, bottom: 8),
    padding: const EdgeInsets.all(22),
    decoration: BoxDecoration(
      color: AppSurfaces.warm,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: const Color(0xFFE9E1D2)),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(
          Icons.lightbulb_outline_rounded,
          color: Color(0xFF806039),
          size: 24,
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'A thought for your next post',
                style: T.small.copyWith(color: const Color(0xFF705431)),
              ),
              const SizedBox(height: 8),
              const Text(
                'What’s one thing you see differently after this week?',
                style: T.bodyStrong,
              ),
              const SizedBox(height: 6),
              const Text(
                'A small observation can be the start of a good conversation.',
                style: T.small,
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

class _StudioPainter extends CustomPainter {
  _StudioPainter(this.scene);
  final StudioScene scene;
  static const blue = Color(0xFF0A66C2);
  static const navy = Color(0xFF244969);
  static const sage = Color(0xFF70A38A);
  @override
  void paint(Canvas canvas, Size size) {
    final scale = math.min(size.width / 300, size.height / 210);
    canvas.save();
    canvas.translate(
      (size.width - 300 * scale) / 2,
      (size.height - 210 * scale) / 2,
    );
    canvas.scale(scale);
    void rect(
      double x,
      double y,
      double w,
      double h,
      Color color, [
      double radius = 4,
    ]) {
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(x, y, w, h),
          Radius.circular(radius),
        ),
        Paint()..color = color,
      );
    }

    void line(
      double x,
      double y,
      double x2,
      double y2,
      Color color, [
      double width = 2,
    ]) {
      canvas.drawLine(
        Offset(x, y),
        Offset(x2, y2),
        Paint()
          ..color = color
          ..strokeWidth = width
          ..strokeCap = StrokeCap.round,
      );
    }

    canvas.drawCircle(
      const Offset(156, 99),
      82,
      Paint()..color = const Color(0xFFDDEBF5),
    );
    canvas.drawCircle(
      const Offset(246, 46),
      18,
      Paint()..color = const Color(0xFFF0D8AC),
    );
    for (var x = 44.0; x < 274; x += 16) {
      for (var y = 40.0; y < 190; y += 16) {
        canvas.drawCircle(
          Offset(x, y),
          0.8,
          Paint()..color = const Color(0xFFC0D5E4),
        );
      }
    }
    canvas.drawOval(
      const Rect.fromLTWH(36, 184, 235, 14),
      Paint()..color = const Color(0xFFD0DFE7),
    );
    // A small plant anchors each composition to a desk.
    line(50.0, 169, 50.0, 112, sage, 3);
    canvas.drawOval(
      const Rect.fromLTWH(28, 120, 24, 12),
      Paint()..color = sage,
    );
    canvas.drawOval(
      const Rect.fromLTWH(50, 132, 25, 12),
      Paint()..color = const Color(0xFF90B79B),
    );
    canvas.drawOval(
      const Rect.fromLTWH(42, 105, 13, 24),
      Paint()..color = sage,
    );
    rect(34, 156, 34, 32, const Color(0xFFD3B390), 6);
    rect(31, 153, 40, 8, const Color(0xFFE3C6A6), 3);
    // Main sheet, gently tilted, with a bound edge and tangible paper shadow.
    canvas.save();
    canvas.translate(157, 110);
    canvas.rotate(-0.09);
    rect(-64, -70, 136, 153, const Color(0xFFBDD0DD), 9);
    rect(-70, -77, 136, 153, Colors.white, 9);
    rect(-70, -77, 9, 153, const Color(0xFFB1CBE1), 4);
    if (scene == StudioScene.routine) {
      rect(-58, -65, 112, 26, blue, 5);
      for (var r = 0; r < 3; r++) {
        for (var c = 0; c < 4; c++) {
          rect(
            -52 + c * 27,
            -24 + r * 28,
            16,
            15,
            r == 1 && c == 2 ? sage : const Color(0xFFE3ECF2),
            4,
          );
        }
      }
    } else {
      rect(-47, -51, 30, 5, blue, 2);
      rect(-47, -31, 91, 7, navy, 3);
      rect(-47, -17, 70.0, 7, navy, 3);
      for (var i = 0; i < 4; i++) {
        rect(
          -47,
          8 + i * 12,
          i == 3 ? 62 : 90.0,
          3,
          const Color(0xFFBDCDD9),
          1,
        );
      }
      rect(-47, 64, 29, 4, const Color(0xFF6D9D8A), 2);
      rect(-11, 64, 39, 4, const Color(0xFF6D9D8A), 2);
    }
    canvas.restore();
    // A fountain pen rests beside the sheet.
    canvas.save();
    canvas.translate(230, 137);
    canvas.rotate(0.38);
    rect(-5, -38, 11, 76, blue, 4);
    rect(-5, -38, 11, 13, navy, 3);
    line(2, -23, 2, 19, const Color(0xFF8BB8E2), 2);
    final nib = Path()
      ..moveTo(-5, 38)
      ..lineTo(6, 38)
      ..lineTo(0.5, 50.0)
      ..close();
    canvas.drawPath(nib, Paint()..color = const Color(0xFFE1BB7C));
    line(0.5, 46, 0.5, 50.0, navy, 1.5);
    canvas.restore();
    if (scene == StudioScene.celebrate) {
      canvas.drawCircle(
        const Offset(225, 53),
        28,
        Paint()..color = const Color(0xFF267B5C),
      );
      line(211, 53, 221, 63, Colors.white, 4);
      line(221, 63, 240, 43, Colors.white, 4);
      for (var i = 0; i < 5; i++) {
        final a = (i * 0.6) - 2.6;
        line(
          225 + math.cos(a) * 38,
          53 + math.sin(a) * 38,
          225 + math.cos(a) * 44,
          53 + math.sin(a) * 44,
          sage,
          2,
        );
      }
    } else if (scene == StudioScene.voice) {
      rect(191, 29, 75, 50.0, blue, 12);
      final bubble = Path()
        ..moveTo(203, 75)
        ..lineTo(205, 90)
        ..lineTo(224, 76)
        ..close();
      canvas.drawPath(bubble, Paint()..color = blue);
      for (var i = 0; i < 5; i++) {
        final h = [10.0, 22.0, 30.0, 18.0, 10.0][i];
        line(
          207 + i * 10,
          54 - h / 2,
          207 + i * 10,
          54 + h / 2,
          Colors.white,
          3,
        );
      }
    } else if (scene == StudioScene.ideas) {
      canvas.save();
      canvas.translate(240, 65);
      canvas.rotate(0.15);
      rect(-32, -32, 60.0, 60.0, const Color(0xFFFFE3A9), 6);
      line(-17, -9, 17, -9, const Color(0xFF987B46), 3);
      line(-17, 3, 9, 3, const Color(0xFF987B46), 3);
      line(-17, 15, 14, 15, const Color(0xFF987B46), 3);
      canvas.restore();
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_StudioPainter oldDelegate) => oldDelegate.scene != scene;
}
