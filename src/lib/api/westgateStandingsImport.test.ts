import { describe, it, expect } from "vitest";
import { parseWestgateStandingsCsv } from "./westgateStandingsImport";

describe("parseWestgateStandingsCsv", () => {
  it("parses tab-separated paste (copied from the standings page)", () => {
    const tsv = "\nplace\talias\trecord\tpoints\n1T\tDFLEMING221-2\t42-21-0-0\t42\n59T\t'@VIEWFROMVEGAS-3\t37-26-0-0\t37\n771\tFORBES_500-1\t19-16-0-0\t19\n777T\tDD3'S REVENGE-1\t13-29-0-0\t13\n";
    const r = parseWestgateStandingsCsv(tsv);
    expect(r.errors).toEqual([]);
    expect(r.resolved).toHaveLength(4);
    expect(r.resolved[0]).toEqual({ place_rank: 1, place_label: "1T", alias: "DFLEMING221-2", record: "42-21-0-0", points: 42, cash_prize: null });
    expect(r.resolved[2].place_rank).toBe(771);
    expect(r.resolved[3].alias).toBe("DD3'S REVENGE-1");
  });

  it("still parses comma-separated CSV", () => {
    const r = parseWestgateStandingsCsv("place,alias,record,points,cash_prize\r\n5T,BILL-7,60-36-2-0,61.00,\"$19,800\"\r\n");
    expect(r.errors).toEqual([]);
    expect(r.resolved[0]).toMatchObject({ place_rank: 5, alias: "BILL-7", points: 61, cash_prize: 19800 });
  });
});
