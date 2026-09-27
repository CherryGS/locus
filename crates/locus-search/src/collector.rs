use tantivy::{
    DocId, Score, SegmentOrdinal, SegmentReader,
    collector::{Collector, SegmentCollector},
    columnar::Column,
};

pub(crate) struct Complete {
    pub scoring: bool,
}
pub(crate) struct Segment {
    hi: Column<u64>,
    lo: Column<u64>,
    hits: Vec<(f32, [u8; 16])>,
}
impl Collector for Complete {
    type Fruit = Vec<(f32, [u8; 16])>;
    type Child = Segment;
    fn for_segment(&self, _: SegmentOrdinal, segment: &SegmentReader) -> tantivy::Result<Segment> {
        Ok(Segment {
            hi: segment.fast_fields().u64("_id_hi")?,
            lo: segment.fast_fields().u64("_id_lo")?,
            hits: Vec::new(),
        })
    }
    fn requires_scoring(&self) -> bool {
        self.scoring
    }
    fn merge_fruits(&self, fruits: Vec<Self::Fruit>) -> tantivy::Result<Self::Fruit> {
        Ok(fruits.into_iter().flatten().collect())
    }
}
impl SegmentCollector for Segment {
    type Fruit = Vec<(f32, [u8; 16])>;
    fn collect(&mut self, doc: DocId, score: Score) {
        let mut id = [0; 16];
        id[..8].copy_from_slice(&self.hi.first(doc).unwrap_or_default().to_be_bytes());
        id[8..].copy_from_slice(&self.lo.first(doc).unwrap_or_default().to_be_bytes());
        self.hits.push((score, id));
    }
    fn harvest(self) -> Self::Fruit {
        self.hits
    }
}
