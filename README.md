# Live Info

Dashboard temps réel qui regroupe plein d'infos utiles autour de toi : météo, pluie imminente, qualité de l'air, carburants, séismes, ISS, GPS, speedtest… le tout dans une seule page, sans clé d'API.

Backend en **Flask** (proxy + cache vers des APIs publiques), front en **HTML / CSS / JS vanilla**.

## Fonctionnalités

| Carte | Contenu |
|---|---|
| Alertes & conseils | Orage, rafales, chaleur, gel, UV, brouillard, pluie imminente, air, pollens, séisme proche |
| Météo | Température, ressenti, humidité, vent + rafales, pression, nuages, visibilité, UV |
| Pluie dans les 2 h | Prévision toutes les 15 min |
| 24 h / 7 jours | Courbe température + probabilité de pluie, prévisions quotidiennes |
| Qualité de l'air | Indice européen, PM2.5, PM10, NO₂, O₃, SO₂, pollens (Europe) |
| Soleil & Lune | Lever, coucher, durée du jour, UV max, phase de la lune |
| GPS / Trajet | Vitesse, cap, altitude, précision, distance parcourue, vitesse max / moyenne |
| Carburants | Prix les plus bas autour de toi (France) |
| Séismes | Derniers séismes M4.5+ dans le monde, avec distance |
| ISS | Position, altitude, vitesse, distance de toi |
| Heures du monde | Local, UTC, New York, Tokyo, Sydney, Dubaï |
| Serveur | CPU, RAM, disque, uptime de la machine qui héberge l'app (via `psutil`) |
| Appareil & réseau | OS, navigateur, écran, GPU, réseau, mémoire JS |
| Speedtest | Download, upload, ping (Cloudflare) |
| Batterie / Orientation | Si supporté par l'appareil (surtout mobile) |

Tu peux aussi chercher une ville à la main (barre de recherche) si tu ne veux pas utiliser le GPS.

## Installation

```bash
git clone https://github.com/WewennJr/live-info.git
cd live-info
python -m venv .venv
source .venv/bin/activate      # Windows : .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Puis ouvre http://127.0.0.1:5000

## Configuration

Variables d'environnement (toutes optionnelles) :

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `5000` | Port d'écoute |
| `HOST` | `127.0.0.1` | Mettre `0.0.0.0` pour y accéder depuis un autre appareil |
| `FLASK_DEBUG` | `0` | `1` pour activer le mode debug (**jamais avec `HOST=0.0.0.0`**) |

> **Sur téléphone** : GPS, orientation et batterie ne fonctionnent qu'en **HTTPS** (ou sur `localhost`). Avec `http://192.168.x.x:5000` ils seront bloqués par le navigateur ; passe par un reverse proxy HTTPS ou un tunnel.

## Structure

```
live-info/
├── app.py              # API Flask : proxys avec cache
├── templates/
│   └── index.html
├── static/
│   ├── css/style.css
│   └── js/app.js
├── requirements.txt
└── README.md
```

## API interne

| Route | Description |
|---|---|
| `GET /api/weather?lat&lon` | Météo (actuel, horaire, quotidien, 15 min) |
| `GET /api/air?lat&lon` | Qualité de l'air + pollens |
| `GET /api/geocode?q=` | Recherche de ville |
| `GET /api/reverse-geocode?lat&lon` | Nom du lieu |
| `GET /api/fuel?lat&lon&radius=8` | Carburants les moins chers (France) |
| `GET /api/quakes` | Séismes des dernières 24 h |
| `GET /api/iss` | Position de l'ISS |
| `GET /api/server` | Stats de la machine hôte |

Les réponses sont mises en cache côté serveur (de 5 s pour l'ISS à 24 h pour le géocodage inverse) pour rester sous les limites des APIs.

## Sources de données

- [Open-Meteo](https://open-meteo.com/) : météo, qualité de l'air, géocodage (CC BY 4.0, usage non commercial)
- [Nominatim / OpenStreetMap](https://nominatim.org/) : géocodage inverse (© contributeurs OpenStreetMap)
- [Prix des carburants](https://data.economie.gouv.fr/) : data.economie.gouv.fr (Licence Ouverte)
- [USGS](https://earthquake.usgs.gov/) : séismes
- [Where the ISS at?](https://wheretheiss.at/) : position de l'ISS
- [Cloudflare Speed Test](https://speed.cloudflare.com/) : speedtest