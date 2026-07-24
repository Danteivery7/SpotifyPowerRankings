#!/usr/bin/env python3
import json, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path

API='https://api.stats.fm/api/v1'
USER=os.getenv('STATSFM_USER','31c4puiblaxm3wzzwg3hfc7t75yq')
TZ=ZoneInfo('America/New_York')
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'data'/'latest.json'; HIST=ROOT/'data'/'history'
HIST.mkdir(parents=True,exist_ok=True)
CATS={'songs':('tracks','track'),'artists':('artists','artist'),'albums':('albums','album')}

def get(path, params=None, timeout=30):
    q=('?'+urllib.parse.urlencode(params)) if params else ''
    req=urllib.request.Request(API+path+q,headers={'Accept':'application/json','User-Agent':'DantePowerRankings/1.0'})
    with urllib.request.urlopen(req,timeout=timeout) as r:return json.load(r)

def sunday_cutoff(now=None):
    now=(now or datetime.now(TZ)).astimezone(TZ)
    days=(now.weekday()+1)%7
    s=(now-timedelta(days=days)).replace(hour=9,minute=0,second=0,microsecond=0)
    return s if now>=s else s-timedelta(days=7)

def ms(dt): return int(dt.timestamp()*1000)
def fmt(dt): return dt.strftime('%b %-d, %Y · %-I:%M %p ET')
def label(a,b): return f"{a.strftime('%b %-d, %-I:%M %p')} — {b.strftime('%b %-d, %-I:%M %p ET')}"

def normalize(item, kind):
    obj=item.get(kind,{})
    artists=obj.get('artists') or []
    albums=obj.get('albums') or []
    image=obj.get('image') or next((a.get('image') for a in albums if a.get('image')), '') or next((a.get('image') for a in artists if a.get('image')), '')
    return {'id':str(obj.get('id','')),'name':obj.get('name','Unknown'),'artist':', '.join(a.get('name','') for a in artists if a.get('name')),'genres':obj.get('genres') or [],'image':image,'plays':item.get('streams'),'playedMs':item.get('playedMs'),'sourceRank':item.get('position')}

def top(cat,start=None,end=None,range_name=None,limit=20):
    endpoint,kind=CATS[cat]
    params={'limit':limit,'offset':0}
    if range_name: params['range']=range_name
    else: params.update(after=ms(start),before=ms(end))
    items=get(f'/users/{urllib.parse.quote(USER)}/top/{endpoint}',params).get('items',[])
    out=[]
    for x in items:
        item=normalize(x,kind)
        if item['id']: out.append(item)
    return out

def per_day(cat,item_id,start,end):
    endpoint,_=CATS[cat]
    path=f'/users/{urllib.parse.quote(USER)}/streams/{endpoint}/{urllib.parse.quote(item_id)}/stats/per-day'
    d=get(path,{'after':ms(start),'before':ms(end),'timeZone':'America/New_York'}).get('items',{})
    days=d.get('days',d) if isinstance(d,dict) else {}
    out=[]; cur=start
    while cur<end:
        key=cur.strftime('%Y-%m-%d'); row=days.get(key,{}) if isinstance(days,dict) else {}
        out.append({'count':int(row.get('count',0) or 0),'durationMs':int(row.get('durationMs',row.get('playedMs',0)) or 0)}); cur+=timedelta(days=1)
    return out

def rank(cat,current,previous,start,end,days,recent_days,long=False):
    prevpos={x['id']:i+1 for i,x in enumerate(previous)}
    maxp=max([int(x.get('plays') or 0) for x in current] or [1]); maxm=max([int(x.get('playedMs') or 0) for x in current] or [1])
    enriched=[]
    for x in current[:12]:
        p=int(x.get('plays') or 0); m=int(x.get('playedMs') or 0); active=None; momentum=None
        if not long:
            try:
                series=per_day(cat,x['id'],start,end); active=sum(1 for d in series if d['count']>0)
                recent=series[-recent_days:]; earlier=series[:-recent_days]
                rr=sum(d['count'] for d in recent)/max(1,len(recent)); er=sum(d['count'] for d in earlier)/max(1,len(earlier)); momentum=.5 if rr+er==0 else rr/(rr+er)
            except Exception:
                active=None
        pn=p/max(1,maxp); mn=m/max(1,maxm)
        score=100*((.75*pn+.25*mn) if long or active is None else (.60*pn+.20*mn+.15*(active/days)+.05*momentum))
        enriched.append(dict(x,powerScore=score,activeDays=active,previousRank=prevpos.get(x['id']),peakRank=None))
    enriched.sort(key=lambda x:(-x['powerScore'],-int(x.get('plays') or 0),-int(x.get('playedMs') or 0)))
    for i,x in enumerate(enriched[:5],1):x['rank']=i
    return enriched[:5]

def analysis(items,category):
    if not items:return {}
    lead=items[0]; movers=[x for x in items if x.get('previousRank')]
    up=max(movers,key=lambda x:(x['previousRank']-x['rank']),default=None)
    gap=abs((items[0].get('powerScore') or 0)-(items[1].get('powerScore') or 0)) if len(items)>1 else None
    kind={'songs':'song','artists':'artist','albums':'album'}[category]
    move=(f"{up['name']} +{up['previousRank']-up['rank']}" if up and up['previousRank']>up['rank'] else 'Stable board')
    write=f"{lead['name']} opens at No. 1 in the {kind} rankings with {lead.get('plays') or 0} plays. "
    if up and up['previousRank']>up['rank']: write+=f"{up['name']} makes the strongest climb, rising {up['previousRank']-up['rank']} spots. "
    if gap is not None: write+=(f"The lead is narrow at {gap:.1f} Power Score points." if gap<5 else f"The leader holds a {gap:.1f}-point margin.")
    return {'headline':f"{lead['name']} controls the No. 1 position.",'writeup':write,'leader':lead['name'],'biggestMove':move,'closestRace':('—' if gap is None else f'{gap:.1f} PTS')}

def chart(cat,start,end,prev_start,prev_end,days,recent_days,long=False,range_name=None):
    cur=top(cat,start,end,range_name); prev=[] if long else top(cat,prev_start,prev_end)
    items=rank(cat,cur,prev,start,end,days,recent_days,long)
    return {'rangeLabel':('FULL IMPORTED HISTORY' if range_name=='lifetime' else label(start,end)),'items':items,'analysis':analysis(items,cat)}

def main():
    cutoff=sunday_cutoff(); week0=cutoff-timedelta(days=7); month0=cutoff-timedelta(days=28); year0=cutoff.replace(month=1,day=1,hour=0)
    charts={}
    for cat in CATS:
        charts[cat]={
          'week':chart(cat,week0,cutoff,week0-timedelta(days=7),week0,7,2),
          'month':chart(cat,month0,cutoff,month0-timedelta(days=28),month0,28,7),
          'year':chart(cat,year0,cutoff,None,None,1,1,True),
          'allTime':chart(cat,None,cutoff,None,None,1,1,True,'lifetime')}
        time.sleep(.4)
    payload={'editionLabel':f"Week ending {cutoff.strftime('%b %-d, %Y')}",'cutoffLabel':fmt(cutoff),'updatedLabel':fmt(datetime.now(TZ)),'sourceStatus':'stats.fm verified','cutoffIso':cutoff.isoformat(),'charts':charts}
    temp=OUT.with_suffix('.tmp'); temp.write_text(json.dumps(payload,indent=2,ensure_ascii=False)); temp.replace(OUT)
    (HIST/f"{cutoff.strftime('%Y-%m-%d')}.json").write_text(json.dumps(payload,indent=2,ensure_ascii=False))
    print('Published',payload['editionLabel'])
if __name__=='__main__':
    try:main()
    except Exception as e:
        print(f'Update failed; existing edition preserved: {e}',file=sys.stderr);sys.exit(1)
