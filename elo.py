# In this file, player elo's and tiers can be calculated. 

def get_tier_from_elo(player_elo: int):
    tier = 0
    if 0 <= player_elo < 300:
            tier = 'Bronze'
            print(f'{tier} tier achieved!')
    elif 300 <= player_elo < 600:
            tier = 'SilverI'
            print(f'{tier} tier achieved!')
    elif 600 <= player_elo < 900:
            tier = 'SilverII'
            print(f'{tier} tier achieved!')

    elif 900 <= player_elo < 1200:
            tier = 'SilverIII'
            print(f'{tier} tier achieved!')

    elif 1200 <= player_elo < 1500:
            tier = 'GoldI'
            print(f'{tier} tier achieved!')
    elif 1500 <= player_elo < 1800:
            tier = 'GoldII'
            print(f'{tier} tier achieved!')
    elif 1800 <= player_elo < 2100:
            tier = 'Platinum'
            print(f'{tier} tier achieved!')
    elif 2100 <= player_elo < 2400:
            tier = 'Diamond'
            print(f'{tier} tier achieved!')
    elif 2400 <= player_elo < 2700:
            tier = 'Ruby'
            print(f'{tier} tier achieved!')
    elif 2700 <= player_elo < 3000:
            tier = 'Obsidian'
            print(f'{tier} tier achieved!')
    elif player_elo >= 3000:
            tier = 'Crystal'
            print(f'{tier} tier achieved!')
    return tier


def calculate_elo(winning_elo, losing_elo):
    winning_expected_score  = 1/(1+(10**((losing_elo-winning_elo)/400)))

    if winning_elo < 2100:
        k = 32
    elif winning_elo < 2400:
        k = 24
    else:
        k = 16
    
    new_elo_win = int(round(winning_elo + k*(1-winning_expected_score)))
    new_elo_loss = int(round(losing_elo - k*(1-winning_expected_score)))
    return new_elo_win, new_elo_loss