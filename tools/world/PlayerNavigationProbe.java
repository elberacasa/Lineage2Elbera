// Elbera Tools: bounded, read-only configured-server navigation reproduction.
// Uses installed aCis block readers and direction enum; never starts GeoEngine,
// a game server, sockets, accounts or database code. This is not retail proof.
import java.nio.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import net.sf.l2j.gameserver.geoengine.geodata.*;
import net.sf.l2j.gameserver.enums.GeoType;
import net.sf.l2j.gameserver.enums.MoveDirectionType;

class PlayerNavigationProbe {
    static final int ORIGIN_X = -98304, ORIGIN_Y = 229376; // Recorded tile17_25.
    final ByteBuffer data;
    final int[] offsets = new int[65536];
    final Map<Integer, ABlock> cache = new HashMap<>();

    static String sha(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }
    static void require(boolean ok, String message) {
        if (!ok) throw new IllegalStateException(message);
    }
    static void pinClass(String name, String expected) throws Exception {
        try (var stream = ClassLoader.getSystemResourceAsStream("net/sf/l2j/gameserver/" + name + ".class")) {
            require(stream != null && sha(stream.readAllBytes()).equals(expected), "configured class drift: " + name);
        }
    }
    PlayerNavigationProbe(byte[] raw) {
        data = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN);
        data.position(18);
        for (int i = 0; i < offsets.length; i++) {
            offsets[i] = data.position();
            int type = data.getShort();
            if (type == 0) data.position(data.position() + 4);
            else if (type == 64) data.position(data.position() + 128);
            else for (int c = 0; c < 64; c++) {
                int layers = data.getShort();
                require(layers > 0 && layers <= 127, "invalid layer count");
                data.position(data.position() + 2 * layers);
            }
        }
        require(!data.hasRemaining(), "unexplained raw geodata bytes");
        BlockMultilayer.initialize();
    }
    static int gx(int x) { return (x - ORIGIN_X) >> 4; }
    static int gy(int y) { return (y - ORIGIN_Y) >> 4; }
    ABlock block(int x, int y) {
        require(x >= 0 && x < 2048 && y >= 0 && y < 2048, "outside recorded tile");
        int index = (x >> 3) * 256 + (y >> 3);
        return cache.computeIfAbsent(index, key -> {
            data.position(offsets[key]);
            int type = data.getShort();
            return type == 0 ? new BlockFlat(data, GeoType.L2OFF) : type == 64
                ? new BlockComplex(data) : new BlockMultilayer(data, GeoType.L2OFF);
        });
    }
    int height(int x, int y, int z) { return block(gx(x), gy(y)).getHeightNearest(gx(x), gy(y), z, null); }

    // GeoEngine.canMove traversal, with only world bounds/debug branches omitted.
    // Input is restricted to this one recorded tile. Actual ABlock methods and
    // MoveDirectionType come from the pinned installed jar, not the browser.
    boolean canMove(int ox, int oy, int oz, int tx, int ty, int tz) {
        int x = gx(ox), y = gy(oy), z = height(ox, oy, oz), targetX = gx(tx), targetY = gy(ty);
        int nswe = block(x, y).getNsweNearest(x, y, z, null);
        double slope = (double) (ty - oy) / (tx - ox);
        var dir = MoveDirectionType.getDirection(targetX - x, targetY - y);
        int gridX = ox & 0xfffffff0, gridY = oy & 0xfffffff0;
        while (x != targetX || y != targetY) {
            int checkX = gridX + dir.getOffsetX();
            int checkY = (int) (oy + slope * (checkX - ox));
            int flag;
            if (dir.getStepX() != 0 && gy(checkY) == y) {
                gridX += dir.getStepX(); x += dir.getSignumX(); flag = dir.getDirectionX();
            } else {
                gridY += dir.getStepY(); y += dir.getSignumY(); flag = dir.getDirectionY();
            }
            if ((nswe & flag) == 0) return false;
            var next = block(x, y);
            int at = next.getIndexBelow(x, y, z + GeoStructure.CELL_IGNORE_HEIGHT, null);
            if (at < 0) return false;
            z = next.getHeight(at, null); nswe = next.getNswe(at, null);
        }
        return z == height(tx, ty, tz);
    }

    public static void main(String[] args) throws Exception {
        boolean segments = args.length > 0 && args[0].equals("--segments");
        Path root = segments || args.length == 0 ? Path.of(".") : Path.of(args[0]);
        pinClass("model/actor/move/PlayerMove", "d575720eba25dfccfa148007d7163d007b142d090279f673902058a656197b34");
        pinClass("geoengine/GeoEngine", "88398f88d0eac7785124f8737b77d7b0393ec1b3e0574f831b2169a1c88751da");
        pinClass("enums/MoveDirectionType", "79e1a4a7fd6d3c1519f274a3128480beea6aedc2f77da31e3350889165928e76");
        pinClass("geoengine/geodata/ABlock", "a64c171634c0f0b0b6a4ce7788bcf7b655a9f4c057858f59fd777ad062f3935e");
        pinClass("geoengine/geodata/BlockFlat", "dc88170c9266294db0191179581e6002ac959ada8fc67bbe2e4c3f6d50d72fb7");
        pinClass("geoengine/geodata/BlockComplex", "d85d637252a654cae167c36dba9c1c15d4a779c8bcf27456f0ad3333cc0d90c6");
        pinClass("geoengine/geodata/BlockMultilayer", "148f63f6ff71a044f9da1c8f76c43a24d4e2c7bb4c66de17c20daef8893ff3b0");
        pinClass("geoengine/geodata/GeoStructure", "43542adeb8435d657fe979ed9551e5f6ae3420abc7c1f6f32651d199182aa412");
        byte[] raw = Files.readAllBytes(root.resolve("server/aCis_gameserver/build/dist/gameserver/data/geodata/17_25_conv.dat"));
        require(sha(raw).equals("6463ccb36e8abffdd1c1c73f2749b9288650940d5ddae484f2ade5fdd1beff34"), "recorded geodata drift");
        var probe = new PlayerNavigationProbe(raw);
        if (segments) {
            require(args.length >= 3, "--segments requires at least two x,y,z points");
            int[] previous = null;
            for (int i = 1; i < args.length; i++) {
                int[] point = Arrays.stream(args[i].split(",")).mapToInt(Integer::parseInt).toArray();
                require(point.length == 3, "expected x,y,z point");
                if (previous != null) require(probe.canMove(previous[0], previous[1], previous[2], point[0], point[1], point[2]), "blocked segment " + i);
                previous = point;
            }
            System.out.println("Elbera Tools: " + (args.length - 2) + " segments pass independent configured Java geodata traversal; no move sent.");
            return;
        }
        int x = -84672, y = 245056, z = -3720, tx = -84928, ty = 244928;
        double accurateX = x, accurateY = y;
        require(probe.canMove(x, y, z, tx, ty, z), "initial recorded line must pass");
        // Recorded walkSpeed80 and speedMul; scheduled100ms, not measured tick
        // timestamps. First5 updates use walking speed in configured PlayerMove.
        float speed = (float) (80 * 1.100000023841858);
        for (int tick = 1; tick <= 5; tick++) {
            double dx = tx - x, dy = ty - y;
            double distance = Math.sqrt(dx * dx + dy * dy);
            double fraction = (speed / (1000d / 100)) / distance;
            accurateX += dx * fraction; accurateY += dy * fraction;
            int nx = (int) Math.round(accurateX), ny = (int) Math.round(accurateY);
            int nz = probe.height(nx, ny, z + 2 * GeoStructure.CELL_HEIGHT);
            boolean allowed = probe.canMove(x, y, z, nx, ny, nz);
            System.out.printf(Locale.ROOT, "{\"tick\":%d,\"from\":[%d,%d,%d],\"next\":[%d,%d,%d],\"allowed\":%b}%n", tick, x, y, z, nx, ny, nz, allowed);
            if (!allowed) {
                require(tick == 5 && x == -84703 && y == 245040 && z == -3720,
                    "must reproduce the observed stopped coordinate on the fifth attempt");
                System.out.println("Elbera Tools: configured Java tick reproduction matches recorded stop; no server or account started.");
                return;
            }
            x = nx; y = ny; z = nz;
        }
        throw new IllegalStateException("recorded boundary was not reproduced");
    }
}
